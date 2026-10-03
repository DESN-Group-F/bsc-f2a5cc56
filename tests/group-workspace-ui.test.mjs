import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import * as groups from "../work/qa/teaching-groups.mjs";
import * as maintenance from "../work/qa/group-maintenance.mjs";
import * as activity from "../work/qa/group-activity.mjs";
import * as query from "../work/qa/inventory-query.mjs";
import * as client from "../work/qa/client-utils.mjs";
import * as lifecycle from "../work/qa/battery-lifecycle.mjs";
import * as locations from "../work/qa/location-catalog.mjs";

// Actual component functions and public handlers, with inert UI/transport boundaries.
// These tests do not operate a browser or verify React DOM integration or visual layout.
const jsx=(type,props,key)=>({type,props:props??{},key});
const ui=Object.fromEntries(["ArrowLeft","Battery","Package","Plus","Download","Upload","Pencil","Settings2","ClipboardList","Copy","Button","Input","Textarea","Label","Checkbox","Select","SelectTrigger","SelectValue","SelectContent","SelectItem","Dialog","DialogContent","DialogHeader","DialogTitle","DialogDescription","DialogFooter","Table","TableHeader","TableBody","TableRow","TableHead","TableCell","Skeleton","Tabs","TabsList","TabsTrigger","InventoryTable","TeachingGroupsPanel","InventoryFilterPanel","AppliedFilters","ActivityExportDialog","RecordPicker"].map(name=>[name,name]));
function hooks(){const state=[],effects=[];let pointer=0,ep=0,pending=[];return {reset(){pointer=0;ep=0;pending=[];},useState(initial){const i=pointer++;if(!(i in state))state[i]=typeof initial==="function"?initial():initial;return [state[i],value=>{state[i]=typeof value==="function"?value(state[i]):value;}];},useRef(initial){const i=pointer++;if(!(i in state))state[i]={current:initial};return state[i];},useEffect(callback,deps){const i=ep++,prior=effects[i];if(!prior||!deps||deps.some((v,k)=>!Object.is(v,prior.deps?.[k])))pending.push(()=>{prior?.cleanup?.();effects[i]={deps,cleanup:callback()};});},commit(){pending.forEach(fn=>fn());},unmount(){effects.forEach(e=>e?.cleanup?.());}};}
async function mount(file,exportName,props,extra={}){const state=hooks(),source=ts.transpileModule(await readFile(file,"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/^import .*;\r?\n/gm,"").replace(/^export /gm,"");const bindings={...ui,...groups,...maintenance,...activity,...query,...client,...lifecycle,...locations,...state,currentSydneyDate:()=>"2026-10-03",...extra},names=Object.keys(bindings),component=new Function(...names,"_jsx","_jsxs","_Fragment",`${source}\nreturn ${exportName};`)(...names.map(n=>bindings[n]),jsx,jsx,"Fragment");return {props,render(){state.reset();const tree=component(props);state.commit();return tree;},unmount:state.unmount};}
function nodes(tree,result=[]){if(Array.isArray(tree))tree.forEach(child=>nodes(child,result));else if(tree&&typeof tree==="object"){result.push(tree);nodes(tree.props?.children,result);}return result;}
function text(tree){return typeof tree==="string"||typeof tree==="number"?String(tree):Array.isArray(tree)?tree.map(text).join(""):tree&&typeof tree==="object"?text(tree.props?.children):"";}
const button=(tree,label)=>nodes(tree).find(n=>n.type==="Button"&&text(n)===label);
const input=(tree,label)=>nodes(tree).find(n=>n.type==="Input"&&n.props["aria-label"]===label);
const select=(tree,label)=>nodes(tree).find(n=>n.type==="Select"&&nodes(n).some(child=>child.props["aria-label"]===label));
const at="2026-10-03T05:00:00.000Z";
function fixture(){const id="group-ui-admin",group={id:crypto.randomUUID(),name:"Teaching class",notes:"My class",batteryIds:["BAT-1","BAT-2","BAT-3"],version:1,ownerAccountId:id,state:"active",createdAt:at,updatedAt:at};const batteries=[1,2,3,4].map((n)=>({id:`BAT-${n}`,name:`Battery ${n}`,model:"",chemistry:"",capacityMah:null,voltage:null,tagId:null,version:1,ownerId:`staff-${id}`,ownerName:"Teacher",ownerAccountId:id,homeBuildingId:"J18",homeBuildingName:"Willis Annexe",homeRoomId:null,manufacturedOn:null,firstUsedOn:null,registeredAt:at,lifecycleStatus:n===3?"scrapped":"active",loanId:n===2?crypto.randomUUID():null,borrowerAccountId:n===2?id:null,borrowerName:n===2?"Teacher":null,checkedOutAt:n===2?at:null,observedAt:null,chargedAt:null,lastCheckedOutAt:null}));return {dataset:"demo",user:{id,role:"admin",username:"teacher",displayName:"Teacher"},batteries,teachingGroups:[group],people:[{id:`staff-${id}`,accountId:id,role:"staff",name:"Teacher",version:1}],staffDirectory:[{id,active:true,username:"teacher"}],rooms:[],buildings:[],events:[]};}
function groupReceipt(data,payload){return {requestId:payload.requestId,dataset:data.dataset,actorAccountId:data.user.id,kind:payload.kind,batteryIds:payload.items.map(i=>i.batteryId),at,replayed:false,teachingGroup:{...payload.teachingGroup,name:data.teachingGroups[0].name,ownerAccountId:data.user.id,operationId:payload.requestId,batteryIds:payload.items.map(i=>i.batteryId)}};}

test("the teaching workspace browses groups with mixed states, clears search and opens a fixed group workspace",async()=>{
    const data=fixture(),selected=[],writes=[],returns=[];const view=await mount("components/inventory/teaching-groups-workspace.tsx","TeachingGroupsWorkspace",{data,ready:true,activeId:null,onActiveChange:id=>selected.push(id),onBack:()=>returns.push(true),onMovement:(...args)=>writes.push(args),onRemoval(){},onMaintenance(){},onEdit(){},onDetail(){},onExport(){},onChanged:async()=>{},onDialogChange(){},onActivity(){}});
    assert.match(text(view.render()),/3 batteries · 1 in store · 1 in use · 1 retired/);input(view.render(),"Search teaching groups").props.onChange({target:{value:"Other class"}});assert.match(text(view.render()),/No matching groups/);button(view.render(),"Clear filters").props.onClick();button(view.render(),"Open group").props.onClick();assert.deepEqual(selected,[data.teachingGroups[0].id]);assert.equal(writes.length,0);
    button(view.render(),"Back to previous page").props.onClick();assert.equal(returns.length,1);
    view.props.activeId=selected[0];const inventory=nodes(view.render()).find(n=>n.type==="InventoryTable");assert.equal(inventory.props.group.id,selected[0]);inventory.props.onMovement("checkout",["BAT-1"]);assert.deepEqual(writes[0],["checkout",["BAT-1"],{id:selected[0],version:1}]);button(view.render(),"Back to previous page").props.onClick();assert.equal(returns.length,2);
    view.props.returnBlocked=true;assert.equal(button(view.render(),"Back to previous page").props.disabled,true);
    view.props.returnBlocked=false;view.props.activeId=crypto.randomUUID();assert.match(text(view.render()),/group was removed/);assert.ok(button(view.render(),"Back to previous page"));view.unmount();
});
test("teaching group navigation returns to the entry view, retains its battery-list scope and respects modal locks", async () => {
    const file = ts.createSourceFile("inventory-app.tsx", await readFile("app/inventory-app.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const app = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "InventoryApp");
    const functionNames = ["openTeachingGroups", "returnFromTeachingGroups"];
    const valueNames = ["personalScope", "inventoryView", "inventorySourceView", "retainInventory", "inventoryPersonalScope"];
    const statements = app.body.statements.filter(node => ts.isFunctionDeclaration(node) ? functionNames.includes(node.name?.text) : ts.isVariableStatement(node) && node.declarationList.declarations.some(value => valueNames.includes(value.name.getText(file))));
    const code = ts.transpileModule(statements.map(node => node.getText(file)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    function render(state) {
        const context = { view: state.view, modalOpen: state.modalOpen, groupsReturnView: state.groupsReturnView, user: state.user, setView: value => state.view = value, setGroupsReturnView: value => state.groupsReturnView = value, setActiveGroupId: value => state.activeGroupId = value };
        const names = Object.keys(context);
        return new Function(...names, `${code}\nreturn { openTeachingGroups, returnFromTeachingGroups, personalScope, inventoryView, retainInventory, inventoryPersonalScope };`)(...names.map(name => context[name]));
    }
    for (const [source, scope] of [["inventory", "all"], ["my-batteries", "responsible"], ["my-loans", "borrowed"], ["activity", null], ["messages", null]]) {
        const state = { view: source, groupsReturnView: "inventory", modalOpen: false, user: { role: "staff" }, activeGroupId: "Old group" };
        const before = render(state); before.openTeachingGroups();
        assert.equal(state.view, "teaching-groups"); assert.equal(state.groupsReturnView, source); assert.equal(state.activeGroupId, null);
        const groups = render(state); assert.equal(groups.inventoryView, false); assert.equal(groups.personalScope, "all"); assert.equal(groups.retainInventory, scope !== null);
        if (scope !== null) assert.equal(groups.inventoryPersonalScope, before.inventoryPersonalScope);
        groups.openTeachingGroups(); assert.equal(state.groupsReturnView, source);
        state.modalOpen = true; render(state).returnFromTeachingGroups(); assert.equal(state.view, "teaching-groups");
        state.modalOpen = false; render(state).returnFromTeachingGroups(); assert.equal(state.view, source);
        if (scope !== null) assert.equal(render(state).inventoryPersonalScope, scope);
    }
    const locked = { view: "inventory", groupsReturnView: "my-batteries", modalOpen: true, user: { role: "staff" }, activeGroupId: "Current group" };
    render(locked).openTeachingGroups(); assert.equal(locked.view, "inventory"); assert.equal(locked.activeGroupId, "Current group");
    const demoted = { view: "teaching-groups", groupsReturnView: "accounts", modalOpen: false, user: { role: "staff" } };
    render(demoted).returnFromTeachingGroups(); assert.equal(demoted.view, "inventory");
});

test("group inventory keeps its membership boundary when clearing filters and offers batch maintenance and retired history",async()=>{
    const data=fixture(),calls=[],exports=[];
    const source=ts.transpileModule(await readFile("components/inventory/inventory-filter-panel.tsx","utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/^import .*;\r?\n/gm,"").replace(/^export /gm,"");
    const bindings={...ui,...query,...client,...locations},names=Object.keys(bindings),chips=new Function(...names,"_jsx","_jsxs","_Fragment",`${source}\nreturn appliedFilterChips;`)(...names.map(n=>bindings[n]),jsx,jsx,"Fragment");
    const view=await mount("components/inventory/views.tsx","InventoryTable",{data,group:data.teachingGroups[0],ready:true,onMovement:(...args)=>calls.push(args),onRemoval:ids=>calls.push(["removal",ids]),onGroupMaintenance:ids=>calls.push(["update",ids]),onEdit(){},onDetail(){},onSetup(){},onExport:value=>exports.push(value)}, {appliedFilterChips:chips});
    assert.equal(nodes(view.render()).filter(n=>n.type==="TableRow"&&n.props["aria-selected"]!==undefined).length,3);button(view.render(),"Select all group members").props.onClick();assert.equal(button(view.render(),"Retire or remove selected").props.disabled,true);button(view.render(),"Download selected").props.onClick();assert.deepEqual(exports[0].selectedIds,["BAT-1","BAT-2","BAT-3"]);assert.equal(exports[0].filter.groupId,data.teachingGroups[0].id);
    const applied=nodes(view.render()).find(n=>n.type==="AppliedFilters");applied.props.onClear();assert.equal(nodes(view.render()).filter(n=>n.type==="TableRow"&&n.props["aria-selected"]!==undefined).length,3);assert.match(text(view.render()),/3 selected/);button(view.render(),"Check out group").props.onClick();assert.deepEqual(calls[0],["checkout",["BAT-1","BAT-2","BAT-3"]]);view.unmount();
});
test("group update preserves before network, freezes an uncertain result, restores and retries the original payload",async()=>{
    const data=fixture(),entries=new Map(),requests=[],closed=[];let success=false;
    const storage={getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,value),removeItem:key=>entries.delete(key)},window={dispatchEvent(){}};
    const props={data,group:data.teachingGroups[0],ids:["BAT-1"],onClose:()=>closed.push(true),onChanged:async()=>{},async write(action,payload){requests.push(structuredClone(payload));assert.ok(entries.has(maintenance.groupMaintenanceKey(data.user.id,"demo")));if(!success)throw new Error("Response interrupted");return groupReceipt(data,payload);}};
    const first=await mount("components/inventory/group-maintenance-dialog.tsx","GroupMaintenanceDialog",props,{sessionStorage:storage,window});nodes(first.render()).find(n=>n.type==="RecordPicker").props.onChange(`staff-${data.user.id}`);await button(first.render(),"Confirm update (1)").props.onClick();assert.equal(button(first.render(),"Cancel").props.disabled,true);assert.equal(button(first.render(),"Retry exact group operation").props.disabled,false);first.unmount();
    success=true;const second=await mount("components/inventory/group-maintenance-dialog.tsx","GroupMaintenanceDialog",{...props,group:undefined,ids:[]},{sessionStorage:storage,window});await button(second.render(),"Retry exact group operation").props.onClick();assert.deepEqual(requests[0],requests[1]);assert.equal(entries.size,0);assert.equal(closed.length,1);second.unmount();
});
test("failed recovery storage prevents group writes, while confirmed writes cannot be repeated after a refresh failure",async()=>{
    const data=fixture(),writes=[],storage={getItem(){return null;},setItem(){throw new Error("Storage blocked");},removeItem(){}};
    const props={data,group:data.teachingGroups[0],ids:["BAT-1"],onClose(){},onChanged:async()=>{},write:async(a,p)=>{writes.push(p);return groupReceipt(data,p);}};
    const blocked=await mount("components/inventory/group-maintenance-dialog.tsx","GroupMaintenanceDialog",props,{sessionStorage:storage,window:{dispatchEvent(){}}});nodes(blocked.render()).find(n=>n.type==="RecordPicker").props.onChange(`staff-${data.user.id}`);await button(blocked.render(),"Confirm update (1)").props.onClick();assert.equal(writes.length,0);assert.match(text(blocked.render()),/Restore browser storage/);blocked.unmount();
    const entries=new Map(),working={getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,value),removeItem:key=>entries.delete(key)};const saved=await mount("components/inventory/group-maintenance-dialog.tsx","GroupMaintenanceDialog",{...props,onChanged:async()=>{throw new Error("Refresh failed");}},{sessionStorage:working,window:{dispatchEvent(){}}});nodes(saved.render()).find(n=>n.type==="RecordPicker").props.onChange(`staff-${data.user.id}`);await button(saved.render(),"Confirm update (1)").props.onClick();assert.equal(writes.length,1);assert.ok(button(saved.render(),"Close"));assert.equal(button(saved.render(),"Confirm update (1)"),undefined);assert.match(text(saved.render()),/operation was saved/);saved.unmount();
});
test("activity groups one operation, preserves selected records across clearing and passes the requested export scope",async()=>{
    const data=fixture(),group=data.teachingGroups[0],operationId=crypto.randomUUID(),groupChanges=[];
    const evidence={id:group.id,version:1,name:group.name,ownerAccountId:data.user.id,operationId,batteryIds:["BAT-1","BAT-2"]};
    const events=["BAT-1","BAT-2"].map(id=>({id:crypto.randomUUID(),action:"checkout",batteryId:id,actorName:"Teacher",at,details:{requestId:operationId,teachingGroup:evidence,borrower:"Teacher",source:"Manual selection"}}));
    const view=await mount("components/inventory/views.tsx","ActivityHistory",{data,onDetail(){},scope:"all",revision:0,groupId:group.id,onGroupFilterChange:id=>groupChanges.push(id)},{fetch:async()=>({ok:true,json:async()=>({events})})});view.render();await new Promise(resolve=>setImmediate(resolve));assert.match(text(view.render()),/1 matching operation/);assert.match(text(view.render()),/View 2 recorded battery actions/);
    const selector=nodes(view.render()).find(n=>n.type==="Checkbox"&&String(n.props["aria-label"]).startsWith("Select activity group:"));selector.props.onCheckedChange(true);input(view.render(),"Search activity").props.onChange({target:{value:"No match"}});button(view.render(),"Clear filters").props.onClick();assert.deepEqual(groupChanges,[null]);assert.match(text(view.render()),/1 operations selected/);button(view.render(),"Download selected activity").props.onClick();const download=nodes(view.render()).find(n=>n.type==="ActivityExportDialog");assert.equal(download.props.selectedIds.length,1);assert.equal(download.props.groupId,group.id);assert.equal(download.props.scope,"all");view.unmount();
});
test("activity download supports group summaries or selective battery data and avoids CSV truncation of detail tables",async()=>{
    const downloads=[],view=await mount("components/inventory/activity-export-dialog.tsx","ActivityExportDialog",{dataset:"demo",scope:"mine",search:"Class",groupId:null,selectedIds:["group:some-event"],count:4,onClose(){}},{downloadExportAttachment:async(...args)=>downloads.push(args)});
    select(view.render(),"Activity file format").props.onValueChange("csv");select(view.render(),"Activity information depth").props.onValueChange("battery_details");assert.equal(select(view.render(),"Activity file format").props.value,"xlsx");
    nodes(view.render()).find(n=>n.type==="Checkbox").props.onCheckedChange(false);assert.equal(button(view.render(),"Download activity").props.disabled,true);const section=nodes(view.render()).find(n=>n.type==="label"&&text(n).includes("Complete loan history"));nodes(section).find(n=>n.type==="Checkbox").props.onCheckedChange(true);
    await button(view.render(),"Download activity").props.onClick();assert.equal(downloads[0][0].activityDepth,"battery_details");assert.deepEqual(downloads[0][0].activityIds,["group:some-event"]);assert.deepEqual(downloads[0][0].sections,["loans"]);assert.equal(downloads[0][1],"xlsx");view.unmount();
});
test("a refreshed group membership blocks an old outside selection until the teacher explicitly removes it", async () => {
    const data = fixture(), exports = [];
    const source = ts.transpileModule(await readFile("components/inventory/inventory-filter-panel.tsx", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
    const bindings = { ...ui, ...query, ...client, ...locations }, names = Object.keys(bindings);
    const chips = new Function(...names, "_jsx", "_jsxs", "_Fragment", `${source}\nreturn appliedFilterChips;`)(...names.map(name => bindings[name]), jsx, jsx, "Fragment");
    const view = await mount("components/inventory/views.tsx", "InventoryTable", { data, group: data.teachingGroups[0], ready: true, onMovement() {}, onEdit() {}, onDetail() {}, onSetup() {}, onExport: value => exports.push(value) }, { appliedFilterChips: chips });
    button(view.render(), "Select all group members").props.onClick();
    data.teachingGroups[0] = { ...data.teachingGroups[0], batteryIds: ["BAT-1"], version: 2 };
    view.props.group = data.teachingGroups[0];
    assert.match(text(view.render()), /no longer belong to this teaching group/);
    assert.equal(button(view.render(), "Download selected").props.disabled, true);
    button(view.render(), "Remove batteries outside this view").props.onClick();
    button(view.render(), "Download selected").props.onClick();
    assert.deepEqual(exports[0].selectedIds, ["BAT-1"]);
    view.unmount();
});
