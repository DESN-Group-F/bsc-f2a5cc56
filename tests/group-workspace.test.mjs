import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { InventoryStore } from "../work/qa/store.mjs";
import { TeachingGroupStore } from "../work/qa/teaching-group-store.mjs";
import { groupActivity, filterActivity } from "../work/qa/group-activity.mjs";
import { captureGroupMaintenance, recoverGroupMaintenance, verifyGroupMaintenance } from "../work/qa/group-maintenance.mjs";
import { captureMovementAttempt, verifyMovementReceipt, recoverMovementAttempt } from "../work/qa/movement-session.mjs";
import { captureLifecycleAttempt, verifyLifecycleReceipt } from "../work/qa/lifecycle-session.mjs";
import { scanMovementPayload, recoverScanSession } from "../work/qa/scan-session.mjs";
import { createExport } from "../work/qa/exports.mjs";
import { excelBuffer, summaryCsv } from "../work/qa/downloads.mjs";

const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('group-workspace-test')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "group-workspace-test" }, d1Persist: false });
const db = await mf.getD1Database("DB");
for (const entry of JSON.parse(await readFile("drizzle/meta/_journal.json","utf8")).entries) await db.batch((await readFile(`drizzle/${entry.tag}.sql`,"utf8")).split("--> statement-breakpoint").filter(sql => sql.trim()).map(sql => db.prepare(sql)));
after(() => mf.dispose());
const at = "2026-10-03T05:00:00.000Z", admin = { id: "group-work-admin", name: "Same Name", role: "admin", authVersion: 1 }, staff = { id: "group-work-staff", name: "Same Name", role: "staff", authVersion: 1 }, other = { id: "group-work-other", name: "Same Name", role: "staff", authVersion: 1 };
for (const actor of [admin,staff,other]) await db.prepare("INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(actor.id,actor.id,actor.name,actor.role,"test-only-no-login","test-only-no-login",600000,at,at).run();
async function fixture(name, actor = staff, dataset = "demo", count = 3) {
    const scope = `group-work-${name}:${dataset}`, store = (account = actor, database = db) => new InventoryStore(database,scope,dataset,account,() => new Date(at)), groups = (account = actor,database = db) => new TeachingGroupStore(database,scope,dataset,account,() => new Date(at));
    await store().snapshot(); const ids = Array.from({length:count},(_,i)=>`BAT-${String(i+1).padStart(3,"0")}`);
    for (const id of ids) await store(admin).saveBattery({id,name:"Teaching battery",homeBuildingId:"J18",ownerId:`staff-${actor.id}`,capacityMah:null,voltage:null});
    const result = await groups().save({action:"create",id:crypto.randomUUID(),requestId:crypto.randomUUID(),name:"Original class",notes:"Private definition",batteryIds:ids.slice(0, Math.min(100,count))});
    return {scope,dataset,actor,ids,store,groups,group:result.group,reference:{id:result.group.id,version:result.group.version}};
}
async function maintenance(context, kind = "owner", fields = {}, ids = context.ids) {
    const snapshot = await context.store().snapshot();
    return {requestId:crypto.randomUUID(),teachingGroup:context.reference,kind,items:ids.map(id=>{const b=snapshot.batteries.find(b=>b.id===id);return {batteryId:id,version:b.version,tagId:b.tagId};}),...(kind==="owner"?{ownerId:`staff-${other.id}`} : kind==="storage"?{homeBuildingId:"J18",homeRoomId:null}:kind==="charge"?{completedAt:at,durationMinutes:60}:{roomId:"DEMO-ROOM",observedAt:at}),...fields};
}
async function rename(context, name = "Renamed and changed class", ids = [context.ids[0]]) { return context.groups().save({action:"update",requestId:crypto.randomUUID(),id:context.group.id,expectedVersion:context.group.version,name,notes:"Updated private definition",batteryIds:ids}); }
function beforeCommit(callback) {
    const sqlByStatement = new WeakMap(); let used=false;
    return {prepare(sql){return {bind(...values){const bound=db.prepare(sql).bind(...values);sqlByStatement.set(bound,sql);return bound;}};},async batch(statements){if(!used&&statements.some(statement=>sqlByStatement.get(statement)?.startsWith("INSERT INTO operations"))){used=true;await callback();}return db.batch(statements);}};
}
const groupEntries = async context => groupActivity(await context.store().fullActivity()).filter(entry=>entry.teachingGroup);

test("a native staff group checkout is one shared operation with immutable actual members, and replays after a private rename",async()=>{
    const c=await fixture("checkout"), snapshot=await c.store().snapshot();
    const attempt=captureMovementAttempt("checkout",snapshot.batteries.slice(0,2),staff.id,"demo",crypto.randomUUID(),c.reference);
    const saved=await c.store().movement(attempt.payload); verifyMovementReceipt(saved,attempt.payload,staff.id);
    assert.deepEqual(recoverMovementAttempt(JSON.stringify(attempt),staff.id,"demo","checkout").payload,attempt.payload);
    await rename(c); const entries=await groupEntries(c); assert.equal(entries.length,1); assert.equal(entries[0].teachingGroup.name,"Original class");assert.equal(entries[0].members.length,2);assert.deepEqual(entries[0].teachingGroup.batteryIds,c.ids.slice(0,2));
    const shared=groupActivity(await c.store(other).fullActivity()).filter(entry=>entry.teachingGroup);assert.deepEqual(shared,entries);
    assert.deepEqual((await c.store(other).snapshot()).teachingGroups,[]);
    const replay=await c.store().movement(attempt.payload);assert.equal(replay.replayed,true);verifyMovementReceipt(replay,attempt.payload,staff.id);assert.equal((await groupEntries(c))[0].members.length,2);
    assert.equal(filterActivity(entries,c.ids[0])[0].members.length,2);
});
test("group return preserves exact reviewed loans and still groups the original member evidence",async()=>{
    const c=await fixture("return");await c.store().movement({requestId:crypto.randomUUID(),kind:"checkout",batteryIds:c.ids});
    const snapshot=await c.store().snapshot(), payload=captureMovementAttempt("return",snapshot.batteries,staff.id,"demo",crypto.randomUUID(),c.reference).payload;
    await c.store(other).movement({requestId:crypto.randomUUID(),kind:"return",batteryIds:[c.ids[0]],expectedLoans:[{batteryId:c.ids[0],loanId:snapshot.batteries[0].loanId}]});
    await assert.rejects(c.store().movement(payload),e=>e.code==="movement_rejected_final"); assert.equal((await groupEntries(c)).length,0);
    const current=await c.store().snapshot();const fresh=captureMovementAttempt("return",current.batteries.filter(b=>b.loanId),staff.id,"demo",crypto.randomUUID(),c.reference).payload;
    await c.store().movement(fresh);assert.equal((await groupEntries(c))[0].members.length,2);
});
test("private foreign groups, outside members, stale versions and forged names cannot be used as movement context",async()=>{
    const c=await fixture("authorization");
    await assert.rejects(c.store(other).movement({requestId:crypto.randomUUID(),kind:"checkout",batteryIds:[c.ids[0]],teachingGroup:c.reference}),e=>e.code==="movement_rejected_final");
    await rename(c);await assert.rejects(c.store().movement({requestId:crypto.randomUUID(),kind:"checkout",batteryIds:[c.ids[0]],teachingGroup:c.reference}),e=>e.code==="movement_rejected_final");
    await assert.rejects(c.store().movement({requestId:crypto.randomUUID(),kind:"checkout",batteryIds:[c.ids[1]],teachingGroup:{id:c.group.id,version:2}}),e=>e.code==="movement_rejected_final");
    await assert.rejects(c.store().movement({requestId:crypto.randomUUID(),kind:"checkout",batteryIds:[c.ids[0]],teachingGroup:{...c.reference,name:"Forged class"}}),e=>e.name==="ZodError");
    assert.ok((await c.store().snapshot()).batteries.every(b=>!b.loanId));
});
test("a concurrent group edit at D1 commit rejects the entire checkout with no member actions",async()=>{
    const c=await fixture("group-race"), raced=beforeCommit(()=>rename(c));
    await assert.rejects(c.store(staff,raced).movement({requestId:crypto.randomUUID(),kind:"checkout",batteryIds:c.ids,teachingGroup:c.reference}),e=>e.code==="movement_rejected_final");
    assert.ok((await c.store().snapshot()).batteries.every(b=>!b.loanId));assert.equal((await groupEntries(c)).length,0);
});
test("admin group owner and storage updates are atomic, private to the acting definition and recorded with original member snapshots",async()=>{
    const c=await fixture("maintenance",admin);
    for(const kind of ["owner","storage"]){const payload=await maintenance(c,kind);const saved=await c.store().groupMaintenance(payload);verifyGroupMaintenance(saved,captureGroupMaintenance(admin.id,"demo",payload));assert.equal((await c.store().groupMaintenance(payload)).replayed,true);}
    const snapshot=await c.store().snapshot();assert.ok(snapshot.batteries.every(b=>b.ownerAccountId===other.id&&b.homeRoomId===null&&b.version===3));assert.equal((await groupEntries(c)).length,2);assert.ok((await groupEntries(c)).every(e=>e.members.length===3));
    await assert.rejects(c.store(staff).groupMaintenance(await maintenance(c)),e=>e.status===403);
    const foreign=await fixture("foreign-admin",staff);await assert.rejects(foreign.store(admin).groupMaintenance(await maintenance(foreign)),e=>e.code==="group_operation_rejected_final");
});
test("group charging and demo observations save separate evidence, preserve unknown specifications and replay without duplicates",async()=>{
    const c=await fixture("evidence",admin),room=(await c.store().snapshot()).rooms[0];
    const payloads=[await maintenance(c,"charge"),await maintenance(c,"observation",{roomId:room.id})];
    for(const payload of payloads){const result=await c.store().groupMaintenance(payload);verifyGroupMaintenance(result,captureGroupMaintenance(admin.id,"demo",payload));}
    await rename(c); for(const payload of payloads)assert.equal((await c.store().groupMaintenance(payload)).replayed,true);
    const snapshot=await c.store().snapshot();assert.ok(snapshot.batteries.every(b=>b.chargeDurationMinutes===60&&b.observedAt===at&&b.observationSource==="Demo observation"&&b.capacityMah===null));
    const detail=await c.store().detail(c.ids[0]);assert.equal(detail.charges.length,1);assert.equal(detail.observations.length,1);
});
test("group maintenance rejects a battery version or group change at commit and reserves that exact failure",async()=>{
    for(const race of ["battery","group"]){const c=await fixture(`maintenance-race-${race}`,admin),payload=await maintenance(c,"charge");
        const database=beforeCommit(async()=>{if(race==="group")await rename(c);else{const b=(await c.store().snapshot()).batteries[0];await c.store().saveBattery({...b,expectedVersion:b.version,name:"Edited by another tab",teachingGroup:undefined},true);}});
        await assert.rejects(c.store(admin,database).groupMaintenance(payload),e=>e.code==="group_operation_rejected_final");await assert.rejects(c.store().groupMaintenance(payload),e=>e.code==="group_operation_rejected_final");assert.equal((await groupEntries(c)).length,0);assert.equal((await c.store().detail(c.ids[2])).charges.length,0);
    }
});
test("a saved rejection prevents a paused group update from committing after the conflict clears",async()=>{
    const c=await fixture("paused",admin),payload=await maintenance(c,"charge");let release,announce;const reached=new Promise(r=>announce=r),waiting=new Promise(r=>release=r);
    const database=beforeCommit(async()=>{announce();await waiting;}),original=c.store(admin,database).groupMaintenance(payload);await reached;
    const b=(await c.store().snapshot()).batteries[0];await c.store().saveBattery({...b,expectedVersion:b.version,name:"Concurrent edit"},true);
    await assert.rejects(c.store().groupMaintenance(payload),e=>e.code==="group_operation_rejected_final");release();await assert.rejects(original,e=>e.code==="group_operation_rejected_final");assert.equal((await c.store().detail(c.ids[0])).charges.length,0);
});
test("retirement remains staff-accessible and keeps the teaching group snapshot, identity and detailed history",async()=>{
    const c=await fixture("retirement"),snapshot=await c.store().snapshot();const payload={requestId:crypto.randomUUID(),kind:"scrapped",reason:"",destination:null,source:"manual_selection",teachingGroup:c.reference,items:snapshot.batteries.slice(0,2).map(b=>({batteryId:b.id,version:b.version,tagId:b.tagId}))};
    const result=await c.store().lifecycle(payload);verifyLifecycleReceipt(result,captureLifecycleAttempt(staff.id,"demo",payload));await rename(c);assert.equal((await groupEntries(c))[0].members.length,2);assert.equal((await c.store().detail(c.ids[0])).battery.lifecycleReason,null);
    assert.equal((await c.store().lifecycle(payload)).replayed,true);
});
test("single member edits, charge records and corrections retain their group context without widening permission",async()=>{
    const c=await fixture("member",admin),id=c.ids[0],b=(await c.store().snapshot()).batteries[0];
    await c.store().saveBattery({...b,expectedVersion:b.version,name:"Changed member",teachingGroup:c.reference},true);
    await c.store().charge({requestId:crypto.randomUUID(),batteryId:id,durationMinutes:30,completedAt:at,teachingGroup:c.reference});
    await c.store().movement({requestId:crypto.randomUUID(),kind:"checkout",batteryIds:[id],teachingGroup:c.reference});const loan=(await c.store().snapshot()).batteries[0].loanId;
    await c.store().correctLoan({requestId:crypto.randomUUID(),loanId:loan,action:"checkout_voided",expectedReturnedAt:null,reason:"Wrong battery selected",teachingGroup:c.reference});
    assert.equal((await groupEntries(c)).length,4);assert.ok((await groupEntries(c)).every(e=>e.members.length===1));
    await assert.rejects(c.store(staff).charge({requestId:crypto.randomUUID(),batteryId:id,durationMinutes:30,completedAt:at,teachingGroup:c.reference}),e=>e.status===403);
});
test("activity summary includes the original group name without member details; detailed export includes selected sections and complete histories",async()=>{
    const c=await fixture("exports",admin);await c.store().groupMaintenance(await maintenance(c,"charge"));await rename(c);
    const input={dataset:"demo",mode:"activity",activityGroupId:c.group.id,search:c.ids[0]};
    const summary=await createExport(c.store(other),{...input,activityDepth:"group_summary"});assert.equal(summary.tables.Activity.length,1);assert.equal(summary.tables.Activity[0].teaching_group_name,"Original class");assert.equal(summary.tables.Activity[0].affected_battery_count,3);assert.ok(!JSON.stringify(summary.tables).includes(c.ids[0]));
    assert.match(summaryCsv(summary),/Original class/);
    const details=await createExport(c.store(other),{...input,activityDepth:"battery_details",sections:["charges","specifications"]});assert.equal(details.tables.ActivityMembers.length,3);assert.equal(details.tables.Batteries.length,3);assert.equal(details.tables.Charges.length,3);assert.ok(!("Loans"in details.tables));assert.ok(!("owner_name"in details.tables.Batteries[0]));
    const ExcelJS=(await import("exceljs")).default,book=new ExcelJS.Workbook();await book.xlsx.load(await excelBuffer(details));assert.equal(book.getWorksheet("ActivityMembers").actualRowCount,4);assert.equal(book.getWorksheet("Charges").actualRowCount,4);
});
test("selected group activity uses the same stable IDs as the complete history and respects native personal activity boundaries",async()=>{
    const c=await fixture("selected",admin);await c.store().groupMaintenance(await maintenance(c,"charge"));const entry=(await groupEntries(c))[0];
    const input={dataset:"demo",mode:"activity",activityIds:[entry.id],search:"No matching search",activityDepth:"battery_details",sections:["audit"]};
    const exported=await createExport(c.store(other),input);assert.equal(exported.tables.Activity.length,1);assert.equal(exported.tables.Activity[0].id,entry.id);assert.equal(exported.tables.ActivityMembers.length,3);assert.equal(exported.metadata.search,null);
    await assert.rejects(createExport(c.store(other),{...input,activityScope:"mine"}),e=>e.status===409);await assert.rejects(createExport(c.store(),{...input,activityIds:[entry.id,"unavailable"]}),e=>e.status===409);await assert.rejects(createExport(c.store(),{...input,activityIds:[]}),e=>e.status===400);
});
test("hundred-member operations export one complete group and an archived shortcut never removes shared history",async()=>{
    const c=await fixture("hundred",staff,"demo",100);await c.store().movement({requestId:crypto.randomUUID(),kind:"checkout",batteryIds:c.ids,teachingGroup:c.reference});
    await c.groups().save({action:"remove",id:c.group.id,requestId:crypto.randomUUID(),expectedVersion:1});const entries=await groupEntries(c);assert.equal(entries[0].members.length,100);
    const document=await createExport(c.store(other),{dataset:"demo",mode:"activity",activityGroupId:c.group.id,activityDepth:"battery_details",sections:["loans"]});assert.equal(document.tables.Activity.length,1);assert.equal(document.tables.ActivityMembers.length,100);assert.equal(document.tables.Loans.length,100);
});
test("exact scan and maintenance recovery binds group ID and version and rejects mismatched receipt evidence",async()=>{
    const c=await fixture("recovery",admin),b=(await c.store().snapshot()).batteries[0],sessionId=crypto.randomUUID(),reads=[{battery:b,tagId:b.tagId,source:"selection",readAt:at}];
    const payload=scanMovementPayload("checkout",reads,sessionId,null,crypto.randomUUID(),c.reference),session={sessionId,mode:"batch",room:null,queue:reads,completed:[],issues:[],attempt:{payload,reads,status:"uncertain",message:"Preserved"},teachingGroup:c.reference};
    assert.deepEqual(recoverScanSession(JSON.stringify(session),"checkout").attempt.payload,payload);session.teachingGroup={...c.reference,version:2};assert.equal(recoverScanSession(JSON.stringify(session),"checkout"),null);
    const draft=await maintenance(c,"charge"),attempt=captureGroupMaintenance(admin.id,"demo",draft);assert.deepEqual(recoverGroupMaintenance(JSON.stringify(attempt),admin.id,"demo"),attempt);assert.equal(recoverGroupMaintenance(JSON.stringify(attempt),other.id,"demo"),null);
    const receipt=await c.store().groupMaintenance(draft);assert.throws(()=>verifyGroupMaintenance({...receipt,teachingGroup:{...receipt.teachingGroup,batteryIds:[c.ids[0]]}},attempt));
});
