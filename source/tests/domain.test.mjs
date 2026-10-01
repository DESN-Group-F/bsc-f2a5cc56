import {test,after} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {Miniflare} from "miniflare";
import {InventoryStore} from "../work/qa/store.mjs";
import {parseCsv,importPayload,csvCell,fromSydneyInput,sydneyInput} from "../work/qa/client-utils.mjs";

const mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('test')}}",compatibilityDate:"2026-05-15",d1Databases:{DB:"inventory-test"},d1Persist:false});
const db=await mf.getD1Database("DB");
const journal=JSON.parse(await readFile("drizzle/meta/_journal.json","utf8"));
for(const entry of journal.entries){
  const migration=await readFile(`drizzle/${entry.tag}.sql`,"utf8");
  for(const sql of migration.split("--> statement-breakpoint").filter(s=>s.trim()))await db.prepare(sql).run();
}
after(()=>mf.dispose());
let now=new Date("2026-10-01T02:00:00Z");
const uuid=()=>crypto.randomUUID();
function store(scope,dataset="demo"){return new InventoryStore(db,scope,dataset,{id:"test-teacher",name:"Test Teacher"},()=>now);}
async function demo(scope){const s=store(scope);await s.initializeDemo();return s;}
const request=(kind,batteryIds,borrowerId="demo-student-1")=>({requestId:uuid(),kind,batteryIds,...(kind==="checkout"?{borrowerId}:{})});
const battery=async(s,id)=>(await s.snapshot()).batteries.find(b=>b.id===id);
const domainStatus=status=>e=>e.status===status;

test("fictional demo is initialized once; working inventory and other operators stay empty",async()=>{
  const s=await demo("isolation:demo");await s.initializeDemo();
  assert.equal((await s.snapshot()).batteries.length,6);
  assert.equal((await store("isolation:live","live").snapshot()).batteries.length,0);
  assert.equal((await store("other:demo").snapshot()).people.length,0);
  await assert.rejects(store("isolation:live","live").initializeDemo(),domainStatus(400));
  await assert.rejects(store("other:demo").detail("BAT-001"),domainStatus(404));
});
test("checkout/return preserve ownership and borrower history; retries do not duplicate loans",async()=>{
  const s=await demo("movement:demo"),input=request("checkout",["BAT-001","BAT-001","BAT-002"]);
  assert.equal((await s.movement(input)).count,2);
  assert.equal((await s.movement(input)).replayed,true);
  assert.equal((await s.detail("BAT-001")).loans.length,1);
  assert.equal((await battery(s,"BAT-001")).ownerId,"demo-staff");
  await assert.rejects(s.movement({...input,batteryIds:["BAT-005"]}),domainStatus(409));
  const returnInput=request("return",["BAT-001","BAT-002"]);
  await s.movement(returnInput);await s.movement(returnInput);
  const b=await battery(s,"BAT-001");assert.equal(b.loanId,null);assert.equal(b.borrowerName,null);
  const detail=await s.detail("BAT-001");assert.equal(detail.loans.length,1);assert.equal(detail.loans[0].borrowerName,"Demo Student 01");assert.ok(detail.loans[0].returnedAt);
  assert.equal(detail.events.filter(e=>e.action==="checkout").length,1);assert.equal(detail.events.filter(e=>e.action==="return").length,1);
});
test("conflicting multi-battery checkout is atomic",async()=>{
  const s=await demo("batch:demo");await assert.rejects(s.movement(request("checkout",["BAT-001","BAT-003"])),domainStatus(409));
  assert.equal((await battery(s,"BAT-001")).loanId,null);
  assert.equal((await s.detail("BAT-001")).events.length,0);
  await assert.rejects(s.movement(request("return",["BAT-003","BAT-005"])),domainStatus(409));
  assert.ok((await battery(s,"BAT-003")).loanId);
});
test("concurrent checkout has one winner and no partial batch",async()=>{
  const s=await demo("race-out:demo");
  const results=await Promise.allSettled([s.movement(request("checkout",["BAT-001","BAT-002"])),s.movement(request("checkout",["BAT-001","BAT-005"],"demo-student-2"))]);
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
  assert.equal((await s.detail("BAT-001")).loans.length,1);
  const active=(await s.snapshot()).batteries.filter(b=>["BAT-001","BAT-002","BAT-005"].includes(b.id)&&b.loanId);
  assert.equal(active.length,2);
});
test("concurrent overlapping returns do not partially return the losing batch",async()=>{
  const s=await demo("race-in:demo");await s.movement(request("checkout",["BAT-001"]));
  const results=await Promise.allSettled([s.movement(request("return",["BAT-001","BAT-003"])),s.movement(request("return",["BAT-001","BAT-004"]))]);
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
  assert.equal((await battery(s,"BAT-001")).loanId,null);
  const stillOut=(await s.snapshot()).batteries.filter(b=>["BAT-003","BAT-004"].includes(b.id)&&b.loanId);
  assert.equal(stillOut.length,1);
});
test("observations include time/source; older arrivals never replace newer evidence or loan state",async()=>{
  const s=await demo("observations:demo"),before=(await battery(s,"BAT-003")).loanId;
  const first={requestId:uuid(),batteryId:"BAT-003",roomId:"demo-workshop",observedAt:"2026-10-01T01:00:00Z"};
  await s.observation(first);await s.observation(first);
  await s.observation({requestId:uuid(),batteryId:"BAT-003",roomId:"demo-store",observedAt:"2026-09-30T23:00:00Z"});
  const b=await battery(s,"BAT-003");assert.equal(b.loanId,before);assert.equal(b.observedRoom,"Demo Workshop");assert.equal(b.observedAt,new Date(first.observedAt).toISOString());assert.equal(b.observationSource,"Demo observation");
  assert.equal((await s.detail("BAT-003")).observations.length,2);
  await assert.rejects(store("no-hardware:live","live").observation(first),domainStatus(501));
});
test("historical charge keeps unknown distinct from 0 and orders by completion time",async()=>{
  const s=await demo("charges:demo"),zero={requestId:uuid(),batteryId:"BAT-001",completedAt:"2026-10-01T01:00:00Z",percentage:0};
  await s.charge(zero);await s.charge(zero);assert.equal((await battery(s,"BAT-001")).chargePercentage,0);
  await s.charge({requestId:uuid(),batteryId:"BAT-001",completedAt:"2026-09-29T01:00:00Z",percentage:100});
  assert.equal((await battery(s,"BAT-001")).chargedAt,new Date(zero.completedAt).toISOString());
  await s.charge({requestId:uuid(),batteryId:"BAT-001",completedAt:"2026-10-01T01:30:00Z",percentage:null});
  assert.equal((await battery(s,"BAT-001")).chargePercentage,null);
  await assert.rejects(s.charge({...zero,requestId:uuid(),completedAt:"2027-10-01T01:00:00Z"}),domainStatus(400));
  await assert.rejects(s.charge({...zero,requestId:uuid(),percentage:101}));
});
test("correction reopens a return or voids a checkout while retaining actor, time and reason",async()=>{
  const s=await demo("correction:demo");await s.movement(request("checkout",["BAT-001"]));const loan=(await s.detail("BAT-001")).loans[0];
  await s.movement(request("return",["BAT-001"]));await s.correctLoan({requestId:uuid(),loanId:loan.id,reason:"Return entered for the wrong battery."});
  assert.equal((await battery(s,"BAT-001")).loanId,loan.id);
  let detail=await s.detail("BAT-001");assert.ok(detail.events.find(e=>e.action==="return"));assert.equal(detail.events.find(e=>e.action==="return_reopened").details.before.return_actor_name,"Test Teacher");
  await s.correctLoan({requestId:uuid(),loanId:loan.id,reason:"Checkout was also entered in error."});
  detail=await s.detail("BAT-001");assert.ok(detail.loans[0].cancelledAt);assert.equal(detail.loans.length,1);assert.equal((await battery(s,"BAT-001")).loanId,null);
});
test("older transactions cannot be corrected after a later loan, including identical timestamps",async()=>{
  const s=await demo("latest:demo");await s.movement(request("checkout",["BAT-001"]));const old=(await s.detail("BAT-001")).loans[0];
  await s.movement(request("return",["BAT-001"]));await s.movement(request("checkout",["BAT-001"],"demo-student-2"));
  assert.notEqual((await s.detail("BAT-001")).loans[0].id,old.id);
  await assert.rejects(s.correctLoan({requestId:uuid(),loanId:old.id,reason:"Attempt to edit an older loan."}),domainStatus(409));
  assert.equal((await battery(s,"BAT-001")).borrowerName,"Demo Student 02");
});
test("registration enforces valid ownership, unique tags and atomic CSV imports",async()=>{
  const s=await demo("records:demo");
  await assert.rejects(s.savePerson({id:"demo-staff",name:"Demo Lab Manager",role:"borrower",expectedVersion:1},true),domainStatus(409));
  await assert.rejects(s.saveBattery({id:"BAT-007",name:"Example battery",ownerId:"demo-student-1",homeRoomId:"demo-store"}),domainStatus(400));
  await assert.rejects(s.saveBattery({id:"BAT-007",name:"Example battery",ownerId:"demo-staff",homeRoomId:"demo-store",tagId:"DEMO-TAG-001"}),domainStatus(409));
  await assert.rejects(s.importRecords("people",[{id:"NEW001",name:"Example person",role:"borrower"},{id:"demo-staff",name:"Duplicate",role:"staff"}]),domainStatus(409));
  assert.equal((await s.snapshot()).people.some(p=>p.id==="NEW001"),false);
  await s.importRecords("rooms",[{id:"ROOM001",name:"Example room"}]);
  assert.equal((await s.snapshot()).rooms.some(r=>r.id==="ROOM001"),true);
});
test("CSV parsing handles quotes and rejects malformed rows; export neutralizes formulas",()=>{
  assert.deepEqual(parseCsv('\uFEFFid,name,role\r\nP01,"Example, Person",borrower\r\n'),[{id:"P01",name:"Example, Person",role:"borrower"}]);
  assert.throws(()=>parseCsv('id,name\nP01,"unfinished'));assert.throws(()=>parseCsv("id,id\nP01,P02"));assert.throws(()=>parseCsv("id,name\nP01"));
  assert.throws(()=>importPayload("batteries",[{id:"B01",name:"Example",owner_id:"S01",storage_room_id:"R01",capacity_mah:"bad"}]));
  assert.equal(csvCell("=1+1"),'"\'=1+1"');assert.equal(csvCell('a"b'),'"a""b"');
});
test("Sydney time conversion handles daylight saving and rejects skipped or ambiguous times",()=>{
  assert.equal(fromSydneyInput("2026-10-01T12:00"),"2026-10-01T02:00:00.000Z");
  assert.equal(fromSydneyInput("2026-10-05T12:00"),"2026-10-05T01:00:00.000Z");
  assert.equal(sydneyInput(new Date("2026-10-01T02:00:00Z")),"2026-10-01T12:00");
  assert.throws(()=>fromSydneyInput("2026-10-04T02:30"));assert.throws(()=>fromSydneyInput("2026-04-05T02:30"));
});

function pauseNextBatch(){
  let signal,resume;
  const ready=new Promise(resolve=>{signal=resolve;}),gate=new Promise(resolve=>{resume=resolve;});
  return {ready,resume,db:{prepare:sql=>db.prepare(sql),async batch(statements){signal();await gate;return db.batch(statements);}}};
}
function pausedStore(scope,gate){return new InventoryStore(gate.db,scope,"demo",{id:"test-teacher",name:"Test Teacher"},()=>now);}

test("stale battery, person and room forms cannot overwrite newer data or append audit events",async()=>{
  const s=await demo("versions:demo"),initial=await s.snapshot();
  const cases=[
    {method:"saveBattery",record:initial.batteries.find(b=>b.id==="BAT-001"),first:{capacityMah:9900},second:{name:"Stale name"}},
    {method:"savePerson",record:initial.people.find(p=>p.id==="demo-student-1"),first:{reference:"NEW-REFERENCE"},second:{name:"Stale person name"}},
    {method:"saveRoom",record:initial.rooms.find(r=>r.id==="demo-store"),first:{building:"New building"},second:{name:"Stale room name"}},
  ];
  for(const item of cases){
    const input={...item.record,expectedVersion:item.record.version};
    const saved=await s[item.method]({...input,...item.first},true);assert.equal(saved.version,item.record.version+1);
    const auditCount=(await s.snapshot()).events.length;
    await assert.rejects(s[item.method]({...input,...item.second},true),e=>e.status===409&&e.code==="record_conflict");
    await assert.rejects(s[item.method]({...item.record,...item.second},true),e=>e.status===409&&e.code==="record_conflict");
    assert.equal((await s.snapshot()).events.length,auditCount);
  }
  const latest=await s.snapshot();
  assert.equal(latest.batteries.find(b=>b.id==="BAT-001").capacityMah,9900);
  assert.equal(latest.people.find(p=>p.id==="demo-student-1").reference,"NEW-REFERENCE");
  assert.equal(latest.rooms.find(r=>r.id==="demo-store").building,"New building");
});

test("an edit paused after its preflight cannot overwrite a committed edit",async()=>{
  const scope="metadata-race:demo",s=await demo(scope),original=await battery(s,"BAT-001"),gate=pauseNextBatch();
  const pending=pausedStore(scope,gate).saveBattery({...original,name:"Stale proposed name",expectedVersion:original.version},true);
  const rejected=assert.rejects(pending,e=>e.status===409&&e.code==="record_conflict");
  await gate.ready;
  await s.saveBattery({...original,capacityMah:9900,expectedVersion:original.version},true);
  gate.resume();await rejected;
  const current=await battery(s,"BAT-001");assert.equal(current.capacityMah,9900);assert.equal(current.name,original.name);assert.equal(current.version,2);
  assert.equal((await s.detail("BAT-001")).events.filter(e=>e.action==="battery_updated").length,1);
});

test("staff-role changes and battery registration stay consistent in either concurrent order",async()=>{
  for(const first of ["registration","role-change"]){
    const scope=`owner-race-${first}:demo`,s=await demo(scope),gate=pauseNextBatch();
    await s.savePerson({id:"spare-staff",name:"Spare Staff",role:"staff"});
    const asset={id:"OWNER-RACE-BATTERY",name:"Owner race battery",ownerId:"spare-staff",homeRoomId:"demo-store"};
    const change={id:"spare-staff",name:"Spare Staff",role:"borrower",expectedVersion:1};
    const delayed=pausedStore(scope,gate);
    const pending=first==="registration"?delayed.saveBattery(asset):delayed.savePerson(change,true);
    const rejected=assert.rejects(pending,domainStatus(409));
    await gate.ready;
    if(first==="registration")await s.savePerson(change,true);else await s.saveBattery(asset);
    gate.resume();await rejected;
    const snapshot=await s.snapshot(),person=snapshot.people.find(p=>p.id==="spare-staff"),registered=snapshot.batteries.find(b=>b.id===asset.id);
    if(first==="registration"){assert.equal(person.role,"borrower");assert.equal(registered,undefined);}
    else{assert.equal(person.role,"staff");assert.equal(registered.ownerId,"spare-staff");}
    const violations=await db.prepare("SELECT COUNT(*) AS count FROM batteries b JOIN people p ON p.key=b.owner_key WHERE b.scope=? AND p.role!='staff'").bind(scope).first();
    assert.equal(violations.count,0);
  }
});

test("room name and building snapshots survive later room edits",async()=>{
  const s=await demo("room-snapshots:demo"),initial=(await s.snapshot()).rooms.find(r=>r.id==="demo-store");
  await s.observation({requestId:uuid(),batteryId:"BAT-001",roomId:initial.id,observedAt:now.toISOString()});
  await s.saveRoom({...initial,name:"Renamed room",building:"Different building",expectedVersion:initial.version},true);
  const observation=(await s.detail("BAT-001")).observations[0],current=await battery(s,"BAT-001");
  assert.equal(observation.roomName,initial.name);assert.equal(observation.roomBuilding,initial.building);assert.equal(observation.roomSnapshot,"recorded");
  assert.equal(current.observedRoom,initial.name);assert.equal(current.observedBuilding,initial.building);assert.equal(current.homeRoomName,"Renamed room");
  await assert.rejects(db.prepare("UPDATE observations SET room_name=? WHERE id=?").bind("Rewritten history",observation.id).run(),/CONSTRAINT/i);
});

test("room edits during observation submission reject inconsistent evidence atomically",async()=>{
  const scope="observation-race:demo",s=await demo(scope),room=(await s.snapshot()).rooms.find(r=>r.id==="demo-store"),gate=pauseNextBatch();
  const pending=pausedStore(scope,gate).observation({requestId:uuid(),batteryId:"BAT-001",roomId:room.id,observedAt:now.toISOString()});
  const rejected=assert.rejects(pending,domainStatus(409));await gate.ready;
  await s.saveRoom({...room,name:"Renamed before receipt",expectedVersion:room.version},true);
  gate.resume();await rejected;
  assert.equal((await s.detail("BAT-001")).observations.length,0);
  assert.equal((await s.detail("BAT-001")).events.filter(e=>e.action==="demo_observation").length,0);
});

test("database rejects cross-inventory owner, room, loan, charge and observation references",async()=>{
  const a="constraints-a:demo",b="constraints-b:demo";await demo(a);await demo(b);
  const invalidStatements=[
    db.prepare("UPDATE batteries SET owner_key=?,version=version+1 WHERE scope=? AND id=?").bind(`${b}/demo-staff`,a,"BAT-001"),
    db.prepare("UPDATE batteries SET home_room_key=?,version=version+1 WHERE scope=? AND id=?").bind(`${b}/demo-store`,a,"BAT-001"),
    db.prepare("INSERT INTO batteries(key,scope,id,name,owner_key,home_room_key,created_at) VALUES(?,?,?,?,?,?,?)").bind(`${a}/INVALID`,a,"INVALID","Invalid battery",`${b}/demo-staff`,`${a}/demo-store`,now.toISOString()),
    db.prepare("INSERT INTO loans(id,scope,battery_key,borrower_key,borrower_name,checked_out_at,checkout_actor_id,checkout_actor_name) VALUES(?,?,?,?,?,?,?,?)").bind(uuid(),a,`${a}/BAT-001`,`${b}/demo-student-1`,"Other borrower",now.toISOString(),"test","Test"),
    db.prepare("INSERT INTO loans(id,scope,battery_key,borrower_key,borrower_name,checked_out_at,checkout_actor_id,checkout_actor_name) VALUES(?,?,?,?,?,?,?,?)").bind(uuid(),a,`${b}/BAT-001`,`${a}/demo-student-1`,"Borrower",now.toISOString(),"test","Test"),
    db.prepare("INSERT INTO charges(id,scope,battery_key,completed_at,recorded_at,actor_id,actor_name) VALUES(?,?,?,?,?,?,?)").bind(uuid(),a,`${b}/BAT-001`,now.toISOString(),now.toISOString(),"test","Test"),
    db.prepare("INSERT INTO observations(id,scope,battery_key,room_key,observed_at,received_at,source,room_name,room_building) VALUES(?,?,?,?,?,?,?,?,?)").bind(uuid(),a,`${a}/BAT-001`,`${b}/demo-store`,now.toISOString(),now.toISOString(),"Demo observation","Demo Battery Store","Example building"),
    db.prepare("INSERT INTO observations(id,scope,battery_key,room_key,observed_at,received_at,source,room_name,room_building) VALUES(?,?,?,?,?,?,?,?,?)").bind(uuid(),a,`${b}/BAT-001`,`${a}/demo-store`,now.toISOString(),now.toISOString(),"Demo observation","Demo Battery Store","Example building"),
  ];
  for(const statement of invalidStatements)await assert.rejects(statement.run(),/CONSTRAINT/i);
  assert.equal((await store(a).snapshot()).batteries.length,6);
  assert.equal((await store(a).snapshot()).batteries.find(r=>r.id==="BAT-001").version,1);
});

test("database rejects bypasses of staff ownership, identity and version rules",async()=>{
  const scope="direct-constraints:demo",s=await demo(scope);
  const invalidStatements=[
    db.prepare("UPDATE people SET role='borrower',version=version+1 WHERE key=?").bind(`${scope}/demo-staff`),
    db.prepare("UPDATE batteries SET owner_key=?,version=version+1 WHERE key=?").bind(`${scope}/demo-student-1`,`${scope}/BAT-001`),
    db.prepare("UPDATE rooms SET scope=?,version=version+1 WHERE key=?").bind("other-scope:demo",`${scope}/demo-store`),
    db.prepare("UPDATE people SET name='Unversioned edit' WHERE key=?").bind(`${scope}/demo-staff`),
    db.prepare("INSERT INTO observations(id,scope,battery_key,room_key,observed_at,received_at,source) VALUES(?,?,?,?,?,?,?)").bind(uuid(),scope,`${scope}/BAT-001`,`${scope}/demo-store`,now.toISOString(),now.toISOString(),"Demo observation"),
  ];
  for(const statement of invalidStatements)await assert.rejects(statement.run(),/CONSTRAINT/i);
  assert.equal((await s.snapshot()).people.find(p=>p.id==="demo-staff").role,"staff");
  assert.equal((await s.snapshot()).rooms.find(r=>r.id==="demo-store").version,1);
});

test("migration preserves existing histories and marks missing original room labels explicitly",async()=>{
  const runtime=new Miniflare({modules:true,script:"export default {fetch(){return new Response('legacy')}}",compatibilityDate:"2026-05-15",d1Databases:{DB:"legacy-review"},d1Persist:false});
  try{
    const legacyDb=await runtime.getD1Database("DB"),scope="legacy:demo";
    const initial=await readFile(`drizzle/${journal.entries[0].tag}.sql`,"utf8");
    for(const sql of initial.split("--> statement-breakpoint").filter(s=>s.trim()))await legacyDb.prepare(sql).run();
    const s=new InventoryStore(legacyDb,scope,"demo",{id:"legacy-teacher",name:"Legacy Teacher"},()=>now);await s.initializeDemo();
    await legacyDb.prepare("INSERT INTO observations(id,scope,battery_key,room_key,observed_at,received_at,source) VALUES(?,?,?,?,?,?,?)").bind(uuid(),scope,`${scope}/BAT-001`,`${scope}/demo-store`,now.toISOString(),now.toISOString(),"Demo observation").run();
    const counts={};for(const table of ["batteries","people","rooms","loans","charges","observations","audit_events"])counts[table]=(await legacyDb.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first()).count;
    for(const entry of journal.entries.slice(1)){
      const migration=await readFile(`drizzle/${entry.tag}.sql`,"utf8");
      for(const sql of migration.split("--> statement-breakpoint").filter(s=>s.trim()))await legacyDb.prepare(sql).run();
    }
    for(const [table,count] of Object.entries(counts))assert.equal((await legacyDb.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first()).count,count);
    const before=(await s.detail("BAT-001")).observations[0];assert.equal(before.roomSnapshot,"unavailable");assert.equal(before.roomName,"Room ID: demo-store");assert.equal(before.roomBuilding,null);
    const room=(await s.snapshot()).rooms.find(r=>r.id==="demo-store");assert.equal(room.version,1);
    await s.saveRoom({...room,name:"Room renamed after migration",expectedVersion:1},true);
    assert.deepEqual((await s.detail("BAT-001")).observations[0],before);
    assert.deepEqual((await legacyDb.prepare("PRAGMA foreign_key_check").all()).results,[]);
  }finally{await runtime.dispose();}
});

test("replacement statements cannot bypass versions, staff ownership or historical evidence",async()=>{
  const scope="replacement-guards:demo",s=await demo(scope);
  await s.observation({requestId:uuid(),batteryId:"BAT-001",roomId:"demo-store",observedAt:now.toISOString()});
  const before=await s.snapshot(),detail=await s.detail("BAT-001"),loan=(await s.detail("BAT-003")).loans[0];
  const observation=detail.observations[0],charge=detail.charges[0];
  const invalidStatements=[
    db.prepare("INSERT OR REPLACE INTO people(key,scope,id,name,role) VALUES(?,?,?,?,?)").bind(`${scope}/demo-staff`,scope,"demo-staff","Replacement borrower","borrower"),
    db.prepare("INSERT OR REPLACE INTO rooms(key,scope,id,name,building) VALUES(?,?,?,?,?)").bind(`${scope}/demo-store`,scope,"demo-store","Replacement room","Different building"),
    db.prepare("INSERT OR REPLACE INTO batteries(key,scope,id,name,owner_key,home_room_key,created_at) VALUES(?,?,?,?,?,?,?)").bind(`${scope}/BAT-001`,scope,"BAT-001","Replacement asset",`${scope}/demo-staff`,`${scope}/demo-store`,now.toISOString()),
    db.prepare("INSERT OR REPLACE INTO batteries(key,scope,id,name,owner_key,home_room_key,created_at,tag_id) VALUES(?,?,?,?,?,?,?,?)").bind(`${scope}/NEW-REPLACEMENT`,scope,"NEW-REPLACEMENT","Replacement tag",`${scope}/demo-staff`,`${scope}/demo-store`,now.toISOString(),"DEMO-TAG-002"),
    db.prepare("INSERT OR REPLACE INTO loans(id,scope,battery_key,borrower_key,borrower_name,checked_out_at,checkout_actor_id,checkout_actor_name) VALUES(?,?,?,?,?,?,?,?)").bind(loan.id,scope,`${scope}/BAT-003`,`${scope}/demo-student-2`,"Replacement borrower",now.toISOString(),"test","Test"),
    db.prepare("INSERT OR REPLACE INTO charges(id,scope,battery_key,completed_at,percentage,recorded_at,actor_id,actor_name) VALUES(?,?,?,?,?,?,?,?)").bind(charge.id,scope,`${scope}/BAT-001`,now.toISOString(),0,now.toISOString(),"test","Test"),
    db.prepare("INSERT OR REPLACE INTO observations(id,scope,battery_key,room_key,observed_at,received_at,source,room_name,room_building) VALUES(?,?,?,?,?,?,?,?,?)").bind(observation.id,scope,`${scope}/BAT-001`,`${scope}/demo-workshop`,now.toISOString(),now.toISOString(),"Demo observation","Demo Workshop","Example building"),
  ];
  for(const statement of invalidStatements)await assert.rejects(statement.run(),/CONSTRAINT/i);
  assert.deepEqual(await s.snapshot(),before);assert.deepEqual(await s.detail("BAT-001"),detail);
  assert.equal((await s.detail("BAT-003")).loans[0].borrowerName,loan.borrowerName);
});
