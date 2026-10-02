import {test,after} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {Miniflare} from "miniflare";
import {InventoryStore} from "../work/qa/store.mjs";
import {parseCsv,importPayload,csvCell,fromSydneyInput,sydneyInput,roomLabel} from "../work/qa/client-utils.mjs";

const mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('test')}}",compatibilityDate:"2026-05-15",d1Databases:{DB:"inventory-test"},d1Persist:false});
const db=await mf.getD1Database("DB");
const journal=JSON.parse(await readFile("drizzle/meta/_journal.json","utf8"));
async function applyMigrations(database,entries){
  for(const entry of entries){
    const migration=await readFile(`drizzle/${entry.tag}.sql`,"utf8");
    await database.batch(migration.split("--> statement-breakpoint").filter(s=>s.trim()).map(sql=>database.prepare(sql)));
  }
}
await applyMigrations(db,journal.entries);
await db.prepare("INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").bind("test-teacher","test-teacher","Test Teacher","admin","test-only-no-login","test-only-no-login",600000,"2026-10-01T02:00:00.000Z","2026-10-01T02:00:00.000Z").run();
after(()=>mf.dispose());
let now=new Date("2026-10-01T02:00:00Z");
const uuid=()=>crypto.randomUUID();
function store(scope,dataset="demo"){return new InventoryStore(db,scope,dataset,{id:"test-teacher",name:"Test Teacher",role:"admin",authVersion:1},()=>now);}
const nativeOwner="staff-test-teacher",roomId="J18-DEMO-ROOM",workspaceId="J18-DEMO-WORKSPACE";
async function demo(scope){const s=store(scope);await s.initializeDemo();return s;}
const request=(kind,batteryIds)=>({requestId:uuid(),kind,batteryIds});
async function returnRequest(s,batteryIds){const all=(await s.snapshot()).batteries;return {requestId:uuid(),kind:"return",batteryIds,expectedLoans:[...new Set(batteryIds)].map(batteryId=>({batteryId,loanId:all.find(b=>b.id===batteryId)?.loanId??uuid()}))};}
const battery=async(s,id)=>(await s.snapshot()).batteries.find(b=>b.id===id);
const domainStatus=status=>e=>e.status===status;

test("fictional demo is initialized once; working inventory and other operators stay empty",async()=>{
  const s=await demo("isolation:demo");await s.initializeDemo();
  assert.equal((await s.snapshot()).batteries.length,6);
  assert.equal((await store("isolation:live","live").snapshot()).batteries.length,0);
  assert.equal((await store("other:demo").snapshot()).batteries.length,0);
  assert.ok((await store("other:demo").snapshot()).people.every(person=>person.accountId));
  await assert.rejects(store("isolation:live","live").initializeDemo(),domainStatus(400));
  await assert.rejects(store("other:demo").detail("BAT-001"),domainStatus(404));
});
test("checkout/return preserve ownership and borrower history; retries do not duplicate loans",async()=>{
  const s=await demo("movement:demo"),input=request("checkout",["BAT-001","BAT-001","BAT-002"]);
  assert.equal((await s.movement(input)).count,2);
  assert.equal((await s.movement(input)).replayed,true);
  assert.equal((await s.detail("BAT-001")).loans.length,1);
  assert.equal((await battery(s,"BAT-001")).ownerId,nativeOwner);
  await assert.rejects(s.movement({...input,batteryIds:["BAT-005"]}),domainStatus(409));
  const returnInput=await returnRequest(s,["BAT-001","BAT-002"]);
  await s.movement(returnInput);await s.movement(returnInput);
  const b=await battery(s,"BAT-001");assert.equal(b.loanId,null);assert.equal(b.borrowerName,null);
  const detail=await s.detail("BAT-001");assert.equal(detail.loans.length,1);assert.equal(detail.loans[0].borrowerName,"Test Teacher");assert.ok(detail.loans[0].returnedAt);
  assert.equal(detail.events.filter(e=>e.action==="checkout").length,1);assert.equal(detail.events.filter(e=>e.action==="return").length,1);
});
test("conflicting multi-battery checkout is atomic",async()=>{
  const s=await demo("batch:demo");await s.movement(request("checkout",["BAT-003"]));await assert.rejects(s.movement(request("checkout",["BAT-001","BAT-003"])),domainStatus(409));
  assert.equal((await battery(s,"BAT-001")).loanId,null);
  assert.equal((await s.detail("BAT-001")).events.length,0);
  await assert.rejects(s.movement(await returnRequest(s,["BAT-003","BAT-005"])),domainStatus(409));
  assert.ok((await battery(s,"BAT-003")).loanId);
});
test("concurrent checkout has one winner and no partial batch",async()=>{
  const s=await demo("race-out:demo");
  const results=await Promise.allSettled([s.movement(request("checkout",["BAT-001","BAT-002"])),s.movement(request("checkout",["BAT-001","BAT-005"]))]);
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
  assert.equal((await s.detail("BAT-001")).loans.length,1);
  const active=(await s.snapshot()).batteries.filter(b=>["BAT-001","BAT-002","BAT-005"].includes(b.id)&&b.loanId);
  assert.equal(active.length,2);
});
test("concurrent overlapping returns do not partially return the losing batch",async()=>{
  const s=await demo("race-in:demo");await s.movement(request("checkout",["BAT-001","BAT-003","BAT-004"]));
  const inputs=await Promise.all([["BAT-001","BAT-003"],["BAT-001","BAT-004"]].map(ids=>returnRequest(s,ids)));
  const results=await Promise.allSettled(inputs.map(input=>s.movement(input)));
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
  assert.equal((await battery(s,"BAT-001")).loanId,null);
  const stillOut=(await s.snapshot()).batteries.filter(b=>["BAT-003","BAT-004"].includes(b.id)&&b.loanId);
  assert.equal(stillOut.length,1);
});
test("observations include time/source; older arrivals never replace newer evidence or loan state",async()=>{
  const s=await demo("observations:demo");await s.movement(request("checkout",["BAT-003"]));const before=(await battery(s,"BAT-003")).loanId;
  const first={requestId:uuid(),batteryId:"BAT-003",roomId:workspaceId,observedAt:"2026-10-01T01:00:00Z"};
  await s.observation(first);await s.observation(first);
  await s.observation({requestId:uuid(),batteryId:"BAT-003",roomId,observedAt:"2026-09-30T23:00:00Z"});
  const b=await battery(s,"BAT-003");assert.equal(b.loanId,before);assert.equal(b.observedRoom,"Demo workspace — Placeholder");assert.equal(b.observedAt,new Date(first.observedAt).toISOString());assert.equal(b.observationSource,"Demo observation");
  assert.equal((await s.detail("BAT-003")).observations.length,2);
  await assert.rejects(store("no-hardware:live","live").observation(first),domainStatus(501));
});
test("charging duration and completion stay paired, ordered and idempotent",async()=>{
  const s=await demo("charges:demo"),input={requestId:uuid(),batteryId:"BAT-001",completedAt:"2026-10-01T01:00:00Z",durationMinutes:90};
  await s.charge(input);await s.charge(input);assert.equal((await battery(s,"BAT-001")).chargeDurationMinutes,90);
  await s.charge({requestId:uuid(),batteryId:"BAT-001",completedAt:"2026-09-29T01:00:00Z",durationMinutes:120});
  assert.equal((await battery(s,"BAT-001")).chargedAt,new Date(input.completedAt).toISOString());
  assert.equal((await battery(s,"BAT-001")).chargeDurationMinutes,90);
  assert.equal((await s.detail("BAT-001")).charges.filter(c=>c.completedAt===new Date(input.completedAt).toISOString()).length,1);
  await assert.rejects(s.charge({...input,durationMinutes:80}),domainStatus(409));
  await assert.rejects(s.charge({...input,requestId:uuid(),completedAt:"2027-10-01T01:00:00Z"}),domainStatus(400));
  for(const durationMinutes of [null,0,-1,Infinity,525601])await assert.rejects(s.charge({...input,requestId:uuid(),durationMinutes}));
  await assert.rejects(s.charge({...input,requestId:uuid(),percentage:100}));
  const detail=await s.detail("BAT-001");assert.equal(detail.charges[0].percentage,null);
  assert.equal(detail.events.find(e=>e.action==="charge_recorded").details.durationMinutes,120);
});
test("correction reopens a return or voids a checkout while retaining actor, time and reason",async()=>{
  const s=await demo("correction:demo");await s.movement(request("checkout",["BAT-001"]));const loan=(await s.detail("BAT-001")).loans[0];
  await s.movement(await returnRequest(s,["BAT-001"]));await s.correctLoan({requestId:uuid(),loanId:loan.id,action:"return_reopened",expectedReturnedAt:now.toISOString(),reason:"Return entered for the wrong battery."});
  assert.equal((await battery(s,"BAT-001")).loanId,loan.id);
  let detail=await s.detail("BAT-001");assert.ok(detail.events.find(e=>e.action==="return"));assert.equal(detail.events.find(e=>e.action==="return_reopened").details.before.return_actor_name,"Test Teacher");
  await s.correctLoan({requestId:uuid(),loanId:loan.id,action:"checkout_voided",expectedReturnedAt:null,reason:"Checkout was also entered in error."});
  detail=await s.detail("BAT-001");assert.ok(detail.loans[0].cancelledAt);assert.equal(detail.loans.length,1);assert.equal((await battery(s,"BAT-001")).loanId,null);
});
test("older transactions cannot be corrected after a later loan, including identical timestamps",async()=>{
  const s=await demo("latest:demo");await s.movement(request("checkout",["BAT-001"]));const old=(await s.detail("BAT-001")).loans[0];
  await s.movement(await returnRequest(s,["BAT-001"]));await s.movement(request("checkout",["BAT-001"]));
  assert.notEqual((await s.detail("BAT-001")).loans[0].id,old.id);
  await assert.rejects(s.correctLoan({requestId:uuid(),loanId:old.id,action:"checkout_voided",expectedReturnedAt:null,reason:"Attempt to edit an older loan."}),domainStatus(409));
  assert.equal((await battery(s,"BAT-001")).borrowerName,"Test Teacher");
});
test("registration enforces valid ownership, unique tags and atomic CSV imports",async()=>{
  const s=await demo("records:demo");
  await assert.rejects(s.savePerson({id:nativeOwner,name:"Test Teacher",role:"borrower",expectedVersion:1},true),domainStatus(409));
  await assert.rejects(s.saveBattery({id:"BAT-007",name:"Example battery",ownerId:"missing-staff",homeBuildingId:"J18",homeRoomId:roomId}),domainStatus(400));
  await s.savePerson({id:"unlinked-staff",name:"Unlinked Staff",role:"staff"});
  await assert.rejects(s.saveBattery({id:"BAT-007",name:"Example battery",ownerId:"unlinked-staff",homeBuildingId:"J18",homeRoomId:roomId}),domainStatus(400));
  await assert.rejects(s.saveBattery({id:"BAT-007",name:"Example battery",ownerId:nativeOwner,homeBuildingId:"J18",homeRoomId:roomId,tagId:"DEMO-TAG-001"}),domainStatus(409));
  await assert.rejects(s.importRecords("people",[{id:"NEW001",name:"Example person",role:"borrower"},{id:nativeOwner,name:"Duplicate",role:"staff"}]),domainStatus(409));
  assert.equal((await s.snapshot()).people.some(p=>p.id==="NEW001"),false);
  await s.importRecords("rooms",[{id:"ROOM001",name:"Example room",buildingId:"J18",number:"EXAMPLE"}]);
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
  const queries=new WeakMap();
  function wrap(statement,sql){const proxy=new Proxy(statement,{get(target,key){if(key==="bind")return(...values)=>wrap(target.bind(...values),sql);const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;}});queries.set(proxy,sql);return proxy;}
  return {ready,resume,db:{prepare:sql=>wrap(db.prepare(sql),sql),async batch(statements){if(/^INSERT INTO operations/.test(queries.get(statements[0])??"")){signal();await gate;}return db.batch(statements);}}};
}
function pausedStore(scope,gate){return new InventoryStore(gate.db,scope,"demo",{id:"test-teacher",name:"Test Teacher",role:"admin",authVersion:1},()=>now);}

test("stale battery, person and room forms cannot overwrite newer data or append audit events",async()=>{
  const s=await demo("versions:demo"),initial=await s.snapshot();
  const cases=[
    {method:"saveBattery",record:initial.batteries.find(b=>b.id==="BAT-001"),first:{capacityMah:9900},second:{name:"Stale name"}},
    {method:"savePerson",record:initial.people.find(p=>p.id===nativeOwner),first:{reference:"NEW-REFERENCE"},second:{reference:"STALE-REFERENCE"}},
    {method:"saveRoom",record:initial.rooms.find(r=>r.id===roomId),first:{number:"DEMO-NEW"},second:{name:"Stale room name"}},
    {method:"saveBuilding",record:initial.buildings.find(r=>r.id==="J18"),first:{name:"Updated building name"},second:{name:"Stale building name"}},
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
  assert.equal(latest.people.find(p=>p.id===nativeOwner).reference,"NEW-REFERENCE");
  assert.equal(latest.rooms.find(r=>r.id===roomId).number,"DEMO-NEW");
  assert.equal(latest.buildings.find(r=>r.id==="J18").name,"Updated building name");
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

test("inactive responsible accounts cannot gain batteries before validation or during the atomic commit",async()=>{
  for(const timing of ["before-validation","after-validation"]){
    const scope=`owner-race-${timing}:demo`,accountId=`owner-${timing}`;
    await db.prepare("INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(accountId,accountId,"Spare Staff","staff","test-only-no-login","test-only-no-login",600000,now.toISOString(),now.toISOString()).run();
    const s=await demo(scope),asset={id:"OWNER-RACE-BATTERY",name:"Owner race battery",ownerId:`staff-${accountId}`,homeBuildingId:"J18",homeRoomId:roomId};
    const disable=()=>db.prepare("UPDATE staff_accounts SET active=0,auth_version=auth_version+1,version=version+1 WHERE id=?").bind(accountId).run();
    if(timing==="before-validation"){
      await disable();await assert.rejects(s.saveBattery(asset),domainStatus(400));
    }else{
      const gate=pauseNextBatch(),pending=pausedStore(scope,gate).saveBattery(asset),rejected=assert.rejects(pending,domainStatus(409));
      await gate.ready;await disable();gate.resume();await rejected;
    }
    assert.equal((await s.snapshot()).batteries.some(b=>b.id===asset.id),false);
    assert.equal((await s.snapshot()).events.some(event=>event.batteryId===asset.id),false);
  }
});

test("room name and building snapshots survive later room edits",async()=>{
  const s=await demo("room-snapshots:demo"),initial=(await s.snapshot()).rooms.find(r=>r.id===roomId);
  await s.observation({requestId:uuid(),batteryId:"BAT-001",roomId:initial.id,observedAt:now.toISOString()});
  await s.saveRoom({...initial,name:"Renamed room",expectedVersion:initial.version},true);
  await s.saveBuilding({id:"J18",name:"Updated building label",expectedVersion:1},true);
  const observation=(await s.detail("BAT-001")).observations[0],current=await battery(s,"BAT-001");
  assert.equal(observation.roomName,roomLabel(initial));assert.equal(observation.roomBuilding,initial.building);assert.equal(observation.roomSnapshot,"recorded");
  assert.equal(current.observedRoom,roomLabel(initial));assert.equal(current.observedBuilding,initial.building);assert.equal(current.homeRoomName,"Renamed room");
  assert.equal(current.homeBuildingName,"Updated building label");
  await assert.rejects(db.prepare("UPDATE observations SET room_name=? WHERE id=?").bind("Rewritten history",observation.id).run(),/CONSTRAINT/i);
});

test("room edits during observation submission reject inconsistent evidence atomically",async()=>{
  const scope="observation-race:demo",s=await demo(scope),room=(await s.snapshot()).rooms.find(r=>r.id===roomId),gate=pauseNextBatch();
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
    db.prepare("UPDATE batteries SET owner_key=?,version=version+1 WHERE scope=? AND id=?").bind(`${b}/${nativeOwner}`,a,"BAT-001"),
    db.prepare("UPDATE batteries SET home_room_key=?,version=version+1 WHERE scope=? AND id=?").bind(`${b}/${roomId}`,a,"BAT-001"),
    db.prepare("INSERT INTO batteries(key,scope,id,name,owner_key,home_room_key,created_at) VALUES(?,?,?,?,?,?,?)").bind(`${a}/INVALID`,a,"INVALID","Invalid battery",`${b}/${nativeOwner}`,`${a}/${roomId}`,now.toISOString()),
    db.prepare("INSERT INTO loans(id,scope,battery_key,borrower_key,borrower_name,checked_out_at,checkout_actor_id,checkout_actor_name) VALUES(?,?,?,?,?,?,?,?)").bind(uuid(),a,`${a}/BAT-001`,`${b}/${nativeOwner}`,"Other borrower",now.toISOString(),"test","Test"),
    db.prepare("INSERT INTO loans(id,scope,battery_key,borrower_key,borrower_name,checked_out_at,checkout_actor_id,checkout_actor_name) VALUES(?,?,?,?,?,?,?,?)").bind(uuid(),a,`${b}/BAT-001`,`${a}/${nativeOwner}`,"Borrower",now.toISOString(),"test","Test"),
    db.prepare("INSERT INTO charges(id,scope,battery_key,completed_at,recorded_at,actor_id,actor_name) VALUES(?,?,?,?,?,?,?)").bind(uuid(),a,`${b}/BAT-001`,now.toISOString(),now.toISOString(),"test","Test"),
    db.prepare("INSERT INTO observations(id,scope,battery_key,room_key,observed_at,received_at,source,room_name,room_building) VALUES(?,?,?,?,?,?,?,?,?)").bind(uuid(),a,`${a}/BAT-001`,`${b}/${roomId}`,now.toISOString(),now.toISOString(),"Demo observation","Demo room — Placeholder","J18 - Willis Annexe"),
    db.prepare("INSERT INTO observations(id,scope,battery_key,room_key,observed_at,received_at,source,room_name,room_building) VALUES(?,?,?,?,?,?,?,?,?)").bind(uuid(),a,`${b}/BAT-001`,`${a}/${roomId}`,now.toISOString(),now.toISOString(),"Demo observation","Demo room — Placeholder","J18 - Willis Annexe"),
  ];
  for(const statement of invalidStatements)await assert.rejects(statement.run(),/CONSTRAINT/i);
  assert.equal((await store(a).snapshot()).batteries.length,6);
  assert.equal((await store(a).snapshot()).batteries.find(r=>r.id==="BAT-001").version,1);
});

test("database rejects bypasses of staff ownership, identity and version rules",async()=>{
  const scope="direct-constraints:demo",s=await demo(scope);
  const invalidStatements=[
    db.prepare("UPDATE people SET role='borrower',version=version+1 WHERE key=?").bind(`${scope}/${nativeOwner}`),
    db.prepare("UPDATE people SET account_id=NULL,version=version+1 WHERE key=?").bind(`${scope}/${nativeOwner}`),
    db.prepare("UPDATE rooms SET scope=?,version=version+1 WHERE key=?").bind("other-scope:demo",`${scope}/${roomId}`),
    db.prepare("UPDATE people SET name='Unversioned edit' WHERE key=?").bind(`${scope}/${nativeOwner}`),
    db.prepare("INSERT INTO observations(id,scope,battery_key,room_key,observed_at,received_at,source) VALUES(?,?,?,?,?,?,?)").bind(uuid(),scope,`${scope}/BAT-001`,`${scope}/${roomId}`,now.toISOString(),now.toISOString(),"Demo observation"),
  ];
  for(const statement of invalidStatements)await assert.rejects(statement.run(),/CONSTRAINT/i);
  assert.equal((await s.snapshot()).people.find(p=>p.id===nativeOwner).role,"staff");
  assert.equal((await s.snapshot()).people.find(p=>p.id===nativeOwner).accountId,"test-teacher");
  assert.equal((await s.snapshot()).rooms.find(r=>r.id===roomId).version,1);
});

test("migration preserves existing histories and marks missing original room labels explicitly",async()=>{
  const runtime=new Miniflare({modules:true,script:"export default {fetch(){return new Response('legacy')}}",compatibilityDate:"2026-05-15",d1Databases:{DB:"legacy-review"},d1Persist:false});
  try{
    const legacyDb=await runtime.getD1Database("DB"),scope="legacy:demo";
    await applyMigrations(legacyDb,journal.entries.slice(0,1));
    // Write the old schema directly: today's initializer must not be used as a historical fixture.
    await legacyDb.batch([
      legacyDb.prepare("INSERT INTO people(key,scope,id,name,role) VALUES(?,?,?,?,?)").bind(`${scope}/demo-staff`,scope,"demo-staff","Legacy owner","staff"),
      legacyDb.prepare("INSERT INTO people(key,scope,id,name,role) VALUES(?,?,?,?,?)").bind(`${scope}/borrower`,scope,"borrower","Legacy borrower","borrower"),
      legacyDb.prepare("INSERT INTO rooms(key,scope,id,name,building) VALUES(?,?,?,?,?)").bind(`${scope}/demo-store`,scope,"demo-store","Original legacy room","Unverified legacy building"),
      legacyDb.prepare("INSERT INTO batteries(key,scope,id,name,owner_key,home_room_key,created_at) VALUES(?,?,?,?,?,?,?)").bind(`${scope}/BAT-001`,scope,"BAT-001","Legacy battery",`${scope}/demo-staff`,`${scope}/demo-store`,now.toISOString()),
      legacyDb.prepare("INSERT INTO loans(id,scope,battery_key,borrower_key,borrower_name,checked_out_at,checkout_actor_id,checkout_actor_name) VALUES(?,?,?,?,?,?,?,?)").bind(uuid(),scope,`${scope}/BAT-001`,`${scope}/borrower`,"Legacy borrower",now.toISOString(),"legacy-teacher","Legacy Teacher"),
      ...[0,100,null].map(percentage=>legacyDb.prepare("INSERT INTO charges(id,scope,battery_key,completed_at,percentage,recorded_at,actor_id,actor_name) VALUES(?,?,?,?,?,?,?,?)").bind(uuid(),scope,`${scope}/BAT-001`,now.toISOString(),percentage,now.toISOString(),"legacy-teacher","Legacy Teacher")),
      legacyDb.prepare("INSERT INTO audit_events(id,scope,action,battery_id,actor_id,actor_name,at,details_json) VALUES(?,?,?,?,?,?,?,?)").bind(uuid(),scope,"charge_recorded","BAT-001","legacy-teacher","Legacy Teacher",now.toISOString(),JSON.stringify({percentage:0,completedAt:now.toISOString()})),
    ]);
    const s=new InventoryStore(legacyDb,scope,"demo",{id:"legacy-teacher",name:"Legacy Teacher",role:"admin"},()=>now);
    await legacyDb.prepare("INSERT INTO observations(id,scope,battery_key,room_key,observed_at,received_at,source) VALUES(?,?,?,?,?,?,?)").bind(uuid(),scope,`${scope}/BAT-001`,`${scope}/demo-store`,now.toISOString(),now.toISOString(),"Demo observation").run();
    const counts={};for(const table of ["batteries","people","rooms","loans","charges","observations","audit_events"])counts[table]=(await legacyDb.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first()).count;
    await applyMigrations(legacyDb,journal.entries.slice(1));
    for(const [table,count] of Object.entries(counts))assert.equal((await legacyDb.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first()).count,count);
    const before=(await s.detail("BAT-001")).observations[0];assert.equal(before.roomSnapshot,"unavailable");assert.equal(before.roomName,"Room ID: demo-store");assert.equal(before.roomBuilding,null);
    const room=(await s.snapshot()).rooms.find(r=>r.id==="demo-store");assert.equal(room.version,1);
    const charges=(await s.detail("BAT-001")).charges;
    assert.deepEqual(charges.map(c=>c.percentage).sort(),[0,100,null].sort());assert.ok(charges.every(c=>c.durationMinutes===null));
    const asset=(await s.snapshot()).batteries[0];assert.equal(asset.homeBuildingId,null);assert.equal(asset.borrowerName,"Legacy borrower");
    await s.saveRoom({...room,name:"Room renamed after migration",buildingId:"J18",number:"CONFIRMED-TEST",expectedVersion:1},true);
    assert.deepEqual((await s.detail("BAT-001")).observations[0],before);
    assert.deepEqual((await legacyDb.prepare("PRAGMA foreign_key_check").all()).results,[]);
  }finally{await runtime.dispose();}
});

test("building-only storage can later gain a confirmed room; other scopes and buildings cannot be mixed",async()=>{
  const scope="hierarchy:live",s=store(scope,"live");
  const initial=await s.snapshot();assert.deepEqual(initial.buildings.map(b=>b.id),["E10","G17","J18"]);assert.equal(initial.rooms.length,2);assert.ok(initial.people.some(person=>person.id===nativeOwner&&person.accountId==="test-teacher"));
  await s.saveBattery({id:"BUILDING-ONLY",name:"Pending room battery",ownerId:nativeOwner,homeBuildingId:"J18"});
  let b=await battery(s,"BUILDING-ONLY");assert.equal(b.homeRoomId,null);assert.equal(b.homeRoomName,null);assert.equal(b.homeBuildingName,"Willis Annexe");
  await s.saveRoom({id:"J18-115",name:"Confirmed test room",buildingId:"J18",number:"115",isPlaceholder:false});
  await s.saveBattery({...b,homeRoomId:"J18-115",expectedVersion:b.version},true);
  b=await battery(s,b.id);assert.equal(b.homeRoomNumber,"115");
  await assert.rejects(s.saveRoom({id:"E10-115",name:"Other test room",buildingId:"E10",number:"115"}),domainStatus(400));
  await db.prepare("INSERT INTO rooms(key,scope,id,name,building_key,number) VALUES(?,?,?,?,?,?)").bind(`${scope}/E10-115`,scope,"E10-115","Unavailable test room",`${scope}/E10`,"115").run();
  await assert.rejects(s.saveBattery({...b,homeRoomId:"E10-115",expectedVersion:b.version},true),domainStatus(400));
  await assert.rejects(s.saveRoom({id:"DUPLICATE",name:"Same number",buildingId:"J18",number:"115"}),domainStatus(409));
  await assert.rejects(s.saveRoom({id:"J18-115",name:"Room moved in error",buildingId:"E10",number:"115",expectedVersion:1},true),domainStatus(400));
  await assert.rejects(db.prepare("UPDATE batteries SET home_building_key=?,version=version+1 WHERE key=?").bind(`${scope}/E10`,`${scope}/BUILDING-ONLY`).run(),/CONSTRAINT/i);
  await assert.rejects(db.prepare("INSERT OR REPLACE INTO buildings(key,scope,id,name) VALUES(?,?,?,?)").bind(`${scope}/J18`,scope,"J18","Replacement building").run(),/CONSTRAINT/i);
  const other=store("hierarchy-other:live","live");await other.snapshot();
  await assert.rejects(db.prepare("UPDATE batteries SET home_building_key=?,home_room_key=NULL,version=version+1 WHERE key=?").bind("hierarchy-other:live/J18",`${scope}/BUILDING-ONLY`).run(),/CONSTRAINT/i);
  await assert.rejects(s.saveBattery({...b,homeBuildingId:"E10",homeRoomId:null,expectedVersion:b.version},true),domainStatus(400));
  b=await battery(s,b.id);assert.equal(b.homeRoomId,"J18-115");assert.equal(b.homeBuildingId,"J18");
  await assert.rejects(s.importRecords("batteries",[{id:"VALID",name:"Valid import",ownerId:nativeOwner,homeBuildingId:"J18"},{id:"WRONG",name:"Wrong room",ownerId:nativeOwner,homeBuildingId:"J18",homeRoomId:"E10-115"}]),domainStatus(400));
  assert.equal((await s.snapshot()).batteries.some(x=>x.id==="VALID"),false);
  await s.importRecords("batteries",[{id:"IMPORTED",name:"Unspecified room import",ownerId:nativeOwner,homeBuildingId:"J18",homeRoomId:null}]);
  assert.equal((await battery(s,"IMPORTED")).homeRoomId,null);
  assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results,[]);
});

test("building edits during an observation cannot mix old and new evidence labels",async()=>{
  const scope="building-observation-race:demo",s=await demo(scope),gate=pauseNextBatch();
  const pending=pausedStore(scope,gate).observation({requestId:uuid(),batteryId:"BAT-001",roomId,observedAt:now.toISOString()});
  const rejected=assert.rejects(pending,domainStatus(409));await gate.ready;
  await s.saveBuilding({id:"J18",name:"Renamed before receipt",expectedVersion:1},true);
  gate.resume();await rejected;
  assert.equal((await s.detail("BAT-001")).observations.length,0);
  assert.equal((await s.detail("BAT-001")).events.filter(e=>e.action==="demo_observation").length,0);
});

test("replacement statements cannot bypass versions, staff ownership or historical evidence",async()=>{
  const scope="replacement-guards:demo",s=await demo(scope);
  await s.movement(request("checkout",["BAT-003"]));
  await s.observation({requestId:uuid(),batteryId:"BAT-001",roomId,observedAt:now.toISOString()});
  const before=await s.snapshot(),detail=await s.detail("BAT-001"),loan=(await s.detail("BAT-003")).loans[0];
  const observation=detail.observations[0],charge=detail.charges[0];
  const invalidStatements=[
    db.prepare("INSERT OR REPLACE INTO people(key,scope,id,name,role) VALUES(?,?,?,?,?)").bind(`${scope}/${nativeOwner}`,scope,nativeOwner,"Replacement borrower","borrower"),
    db.prepare("INSERT OR REPLACE INTO rooms(key,scope,id,name,building) VALUES(?,?,?,?,?)").bind(`${scope}/${roomId}`,scope,roomId,"Replacement room","Different building"),
    db.prepare("INSERT OR REPLACE INTO batteries(key,scope,id,name,owner_key,home_room_key,created_at) VALUES(?,?,?,?,?,?,?)").bind(`${scope}/BAT-001`,scope,"BAT-001","Replacement asset",`${scope}/${nativeOwner}`,`${scope}/${roomId}`,now.toISOString()),
    db.prepare("INSERT OR REPLACE INTO batteries(key,scope,id,name,owner_key,home_room_key,created_at,tag_id) VALUES(?,?,?,?,?,?,?,?)").bind(`${scope}/NEW-REPLACEMENT`,scope,"NEW-REPLACEMENT","Replacement tag",`${scope}/${nativeOwner}`,`${scope}/${roomId}`,now.toISOString(),"DEMO-TAG-002"),
    db.prepare("INSERT OR REPLACE INTO loans(id,scope,battery_key,borrower_key,borrower_name,checked_out_at,checkout_actor_id,checkout_actor_name) VALUES(?,?,?,?,?,?,?,?)").bind(loan.id,scope,`${scope}/BAT-003`,`${scope}/${nativeOwner}`,"Replacement borrower",now.toISOString(),"test","Test"),
    db.prepare("INSERT OR REPLACE INTO charges(id,scope,battery_key,completed_at,percentage,recorded_at,actor_id,actor_name) VALUES(?,?,?,?,?,?,?,?)").bind(charge.id,scope,`${scope}/BAT-001`,now.toISOString(),0,now.toISOString(),"test","Test"),
    db.prepare("INSERT OR REPLACE INTO observations(id,scope,battery_key,room_key,observed_at,received_at,source,room_name,room_building) VALUES(?,?,?,?,?,?,?,?,?)").bind(observation.id,scope,`${scope}/BAT-001`,`${scope}/${workspaceId}`,now.toISOString(),now.toISOString(),"Demo observation","Demo workspace — Placeholder","J18 - Willis Annexe"),
  ];
  for(const statement of invalidStatements)await assert.rejects(statement.run(),/CONSTRAINT/i);
  assert.deepEqual(await s.snapshot(),before);assert.deepEqual(await s.detail("BAT-001"),detail);
  assert.equal((await s.detail("BAT-003")).loans[0].borrowerName,loan.borrowerName);
});
