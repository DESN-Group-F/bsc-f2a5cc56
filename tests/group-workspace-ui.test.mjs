import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { bindDownloadFeedback } from "./helpers/download-feedback-harness.mjs";
import { getRolePermissions } from "../work/qa/permissions.mjs";
import * as groups from "../work/qa/teaching-groups.mjs";
import * as maintenance from "../work/qa/group-maintenance.mjs";
import * as activity from "../work/qa/group-activity.mjs";
import * as query from "../work/qa/inventory-query.mjs";
import * as client from "../work/qa/client-utils.mjs";
import * as lifecycle from "../work/qa/battery-lifecycle.mjs";
import * as rowSelection from "../work/qa/client/row-selection.mjs";
import * as selectionQuery from "../work/qa/battery-selection-query.mjs";
import * as locations from "../work/qa/location-catalog.mjs";
import * as arrivals from "../work/qa/new-arrivals.mjs";

// Actual component functions and public handlers, with inert UI/transport boundaries.
// These tests do not operate a browser or verify React DOM integration or visual layout.
const jsx=(type,props,key)=>({type,props:props??{},key});
const ui=Object.fromEntries(["LogIn","LogOut","ArrowLeft","Battery","Package","Plus","Download","Upload","Pencil","Settings2","ClipboardList","Copy","Button","Input","Textarea","Label","Checkbox","Select","SelectTrigger","SelectValue","SelectContent","SelectItem","Dialog","DialogContent","DialogHeader","DialogTitle","DialogDescription","DialogFooter","Table","TableHeader","TableBody","TableRow","TableHead","TableCell","Skeleton","Tabs","TabsList","TabsTrigger","InventoryTable","TeachingGroupsPanel","InventoryFilterPanel","AppliedFilters","ActivityExportDialog","RecordPicker","BatteryFilterControls"].map(name=>[name,name]));
Object.assign(ui, { TeachingCheckoutRuns: "TeachingCheckoutRuns", DownloadAction: "Button", MotionPresence: "MotionPresence", MotionDisclosure: "MotionDisclosure", transitionWorkspace: update => update(), ChevronDown: "ChevronDown", AlertTriangle: "AlertTriangle", styles: new Proxy({}, { get: (_, name) => String(name) }) });
function hooks(){const state=[],effects=[];let pointer=0,ep=0,pending=[];return {reset(){pointer=0;ep=0;pending=[];},useState(initial){const i=pointer++;if(!(i in state))state[i]=typeof initial==="function"?initial():initial;return [state[i],value=>{state[i]=typeof value==="function"?value(state[i]):value;}];},useRef(initial){const i=pointer++;if(!(i in state))state[i]={current:initial};return state[i];},useEffect(callback,deps){const i=ep++,prior=effects[i];if(!prior||!deps||deps.some((v,k)=>!Object.is(v,prior.deps?.[k])))pending.push(()=>{prior?.cleanup?.();effects[i]={deps,cleanup:callback()};});},commit(){pending.forEach(fn=>fn());},unmount(){effects.forEach(e=>e?.cleanup?.());}};}
async function mount(file,exportName,props,extra={}){const state=hooks(),source=ts.transpileModule(await readFile(file,"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/^import .*;\r?\n/gm,"").replace(/^export /gm,"");const bindings={getRolePermissions,...ui,...groups,...maintenance,...activity,...query,...client,...lifecycle,...locations,...selectionQuery,...rowSelection,...arrivals,...state,useDownloadFeedback:bindDownloadFeedback(state),currentSydneyDate:()=>"2026-10-03",...extra},names=Object.keys(bindings),component=new Function(...names,"_jsx","_jsxs","_Fragment",`${source}\nreturn ${exportName};`)(...names.map(n=>bindings[n]),jsx,jsx,"Fragment");return {props,render(){state.reset();const tree=component(props);state.commit();return tree;},unmount:state.unmount};}
function nodes(tree,result=[]){if(Array.isArray(tree))tree.forEach(child=>nodes(child,result));else if(tree&&typeof tree==="object"){result.push(tree);nodes(tree.props?.children,result);}return result;}
function text(tree){return typeof tree==="string"||typeof tree==="number"?String(tree):Array.isArray(tree)?tree.map(text).join(""):tree&&typeof tree==="object"?text(tree.props?.children):"";}
const button=(tree,label)=>nodes(tree).find(n=>n.type==="Button"&&text(n)===label);
const input=(tree,label)=>nodes(tree).find(n=>n.type==="Input"&&n.props["aria-label"]===label);
const select=(tree,label)=>nodes(tree).find(n=>n.type==="Select"&&nodes(n).some(child=>child.props["aria-label"]===label));
const at="2026-10-03T05:00:00.000Z";
function fixture(){const id="group-ui-admin",group={id:crypto.randomUUID(),name:"Teaching class",notes:"My class",batteryIds:["BAT-1","BAT-2","BAT-3"],version:1,ownerAccountId:id,state:"active",createdAt:at,updatedAt:at};const batteries=[1,2,3,4].map((n)=>({id:`BAT-${n}`,name:`Battery ${n}`,model:"",chemistry:"",capacityMah:null,voltage:null,tagId:null,version:1,ownerId:`staff-${id}`,ownerName:"Teacher",ownerAccountId:id,homeBuildingId:"J18",homeBuildingName:"Willis Annexe",homeRoomId:null,manufacturedOn:null,firstUsedOn:null,registeredAt:at,lifecycleStatus:n===3?"scrapped":"active",loanId:n===2?crypto.randomUUID():null,borrowerAccountId:n===2?id:null,borrowerName:n===2?"Teacher":null,checkedOutAt:n===2?at:null,observedAt:null,chargedAt:null,lastCheckedOutAt:null}));return {dataset:"demo",user:{id,role:"admin",username:"teacher",displayName:"Teacher"},batteries,teachingGroups:[group],people:[{id:`staff-${id}`,accountId:id,role:"staff",name:"Teacher",version:1}],staffDirectory:[{id,active:true,username:"teacher"}],rooms:[],buildings:[],events:[]};}
function groupReceipt(data,payload){return {requestId:payload.requestId,dataset:data.dataset,actorAccountId:data.user.id,kind:payload.kind,batteryIds:payload.items.map(i=>i.batteryId),at,replayed:false,teachingGroup:{...payload.teachingGroup,name:data.teachingGroups[0].name,ownerAccountId:data.user.id,operationId:payload.requestId,batteryIds:payload.items.map(i=>i.batteryId)}};}

test("Staff group controls retain daily operations while administrator maintenance appears only with permission", async () => {
    const data = fixture(), actions = [];
    data.user.role = "staff";
    data.teachingGroups[0].batteryIds = ["BAT-1"];
    const view = await mount("components/inventory/inventory-table.tsx", "InventoryTable", {
        data, group: data.teachingGroups[0], ready: true,
        onMovement: (...args) => actions.push(args), onRemoval: ids => actions.push(["retire", ids]),
        onGroupMaintenance() {}, onEdit() {}, onDetail() {}, onSetup() {}, onExport() {},
    }, { appliedFilterChips: () => [] });
    button(view.render(), "Select all group members").props.onClick();
    assert.equal(button(view.render(), "Update selected members"), undefined);
    assert.equal(button(view.render(), "Edit battery"), undefined);
    assert.ok(button(view.render(), "Register battery"));
    assert.equal(button(view.render(), "Retire or remove selected").props.disabled, false);
    button(view.render(), "Check out group").props.onClick();
    button(view.render(), "Retire or remove selected").props.onClick();
    assert.deepEqual(actions, [["checkout", ["BAT-1"]], ["retire", ["BAT-1"]]]);
    data.user.role = "admin";
    assert.equal(button(view.render(), "Update selected members").props.disabled, false);
    assert.equal(button(view.render(), "Edit battery").props.disabled, false);
    data.user.role = "staff";
    assert.equal(button(view.render(), "Update selected members"), undefined);
    assert.equal(button(view.render(), "Edit battery"), undefined);
    assert.match(text(view.render()), /1 selected/);
    view.unmount();
});

test("layered inventory keeps individual asset identity and evidence distinct from teaching groups and selection", async () => {
    const data = fixture(), details = [];
    Object.assign(data.batteries[0], {
        name: "Specific recorded battery name", chemistry: "LiPo", voltage: 11.1, capacityMah: 2200,
        model: "Model with preserved qualification", manufacturedOn: "2025-10-03", tagId: "INDIVIDUAL-TAG",
        homeRoomName: "Registered storage room", homeRoomNumber: "12", homeRoomIsPlaceholder: false,
        observedAt: at, observedRoom: "Observed room evidence", observedBuilding: "Recorded address",
        observationSource: "Staff return confirmation", observationRoomSnapshot: "recorded",
        inspectionPreview: { validRecords: 3, concernRecords: 2, latest: { id: "latest-check", outcome: "no_concern_observed" }, latestConcern: { id: "historical-check", performedAt: at } },
    });
    const view = await mount("components/inventory/inventory-table.tsx", "InventoryTable", { data, ready: true, onMovement() {}, onEdit() {}, onDetail: id => details.push(id), onSetup() {}, onExport() {} }, { appliedFilterChips: () => [] });
    const row = () => nodes(view.render()).find(node => node.type === "TableRow" && node.key === "BAT-1");
    const evidenceId = nodes(row()).find(node => node.type === "Button" && node.props["aria-label"] === "Show additional information for BAT-1").props["aria-controls"];
    const evidence = () => nodes(view.render()).find(node => node.type === "MotionDisclosure" && node.props.id === evidenceId);
    assert.match(text(row()), /Specific recorded battery name/);
    assert.match(text(row()), /BAT-1/);
    assert.match(text(row()), /LiPo · 11.1 V/);
    assert.match(text(row()), /Registered storage room/);
    assert.match(text(row()), /Concern in history/);
    assert.doesNotMatch(text(row()), /2,200|Age since manufacture|Observed room evidence|Teaching class/);
    assert.equal(evidence().props.open, false);
    assert.match(text(evidence()), /2,200 mAh/);
    assert.match(text(evidence()), /Model with preserved qualification/);
    assert.match(text(evidence()), /INDIVIDUAL-TAG/);
    assert.match(text(evidence()), /Age since manufacture/);
    assert.match(text(evidence()), /Observed room evidence/);
    assert.match(text(evidence()), /Staff return confirmation/);
    assert.match(text(evidence()), /do not establish a current unresolved condition/);
    nodes(row()).find(node => node.type === "Button" && node.props["aria-controls"] === evidenceId).props.onClick();
    assert.equal(evidence().props.open, true);
    assert.equal(row().props["aria-selected"], false);
    nodes(row()).find(node => node.type === "Checkbox").props.onCheckedChange(true);
    assert.equal(row().props["aria-selected"], true);
    assert.equal(evidence().props.open, true);
    nodes(row()).find(node => node.type === "button" && node.props["aria-label"] === "View recorded concern evidence for BAT-1").props.onClick();
    assert.deepEqual(details, ["BAT-1"]);
    view.unmount();
});

test("directory visibility distinguishes Staff registration from administrator saved-record maintenance", async () => {
    const data = fixture();
    data.user.role = "staff";
    data.buildings = [{ id: "J18", name: "Willis Annexe", version: 1 }];
    const view = await mount("components/inventory/record-management.tsx", "RecordManagement", {
        data, ready: true, onEdit() {}, onDetail() {}, onImport() {},
    });
    const choose = kind => nodes(view.render()).find(node => node.type === "Tabs").props.onValueChange(kind);
    assert.ok(button(view.render(), "Download filtered list"));
    assert.equal(button(view.render(), "Import CSV"), undefined);
    choose("buildings");
    assert.match(text(view.render()), /View and download shared locations/);
    assert.equal(button(view.render(), "Import CSV"), undefined);
    assert.equal(button(view.render(), "Register building"), undefined);
    assert.equal(nodes(view.render()).some(node => node.type === "TableHead" && text(node) === "ACTIONS"), false);
    data.user.role = "admin";
    assert.ok(button(view.render(), "Import CSV"));
    assert.ok(button(view.render(), "Register building"));
    assert.ok(button(view.render(), "Edit"));
    data.user.role = "staff";
    choose("batteries");
    assert.ok(button(view.render(), "Register battery"));
    assert.ok(button(view.render(), "Import CSV"));
    assert.equal(button(view.render(), "Edit"), undefined);
    data.user.role = "admin";
    const retired = nodes(view.render()).find(node => node.type === "Button" && node.props["aria-label"] === "Edit BAT-3");
    assert.equal(retired.props.disabled, true);
    assert.equal(nodes(view.render()).find(node => node.type === "Button" && node.props["aria-label"] === "Edit BAT-1").props.disabled, false);
    view.unmount();
});

test("group maintenance switches only visible fields, preserves original values and keeps date/room identifiers unique", async () => {
    const data = fixture(), writes = [], view = await mount("components/inventory/group-maintenance-dialog.tsx", "GroupMaintenanceDialog", { data, group: data.teachingGroups[0], ids: ["BAT-1"], write: async (...args) => writes.push(args), onClose() {}, onChanged: async () => {} }, { sessionStorage: { getItem() { return null; } } });
    const picker = id => nodes(view.render()).find(node => node.type === "RecordPicker" && node.props.id === id);
    const field = id => nodes(view.render()).find(node => node.type === "Input" && node.props.id === id);
    const disclosure = id => nodes(view.render()).find(node => node.type === "MotionDisclosure" && node.props.children?.props?.id === id || node.type === "MotionDisclosure" && Array.isArray(node.props.children) && node.props.children.some(child => child?.props?.id === id));
    picker("group-update-owner").props.onChange(`staff-${data.user.id}`);
    assert.equal(disclosure("group-update-owner").props.open, true); assert.equal(picker("group-update-room").props.disabled, true); assert.equal(field("group-update-time").props.disabled, true);
    select(view.render(), "Group update operation").props.onValueChange("charge");
    assert.equal(picker("group-update-owner").props.disabled, true); assert.equal(disclosure("group-update-time").props.open, true); assert.equal(disclosure("group-update-duration").props.open, true);
    field("group-update-time").props.onChange({ target: { value: "2026-10-08T10:00" } }); field("group-update-duration").props.onChange({ target: { value: "45" } });
    select(view.render(), "Group update operation").props.onValueChange("observation");
    assert.equal(disclosure("group-update-room").props.open, true); assert.equal(field("group-update-duration").props.disabled, true); assert.equal(field("group-update-time").props.value, "2026-10-08T10:00");
    select(view.render(), "Group update operation").props.onValueChange("owner");
    assert.equal(picker("group-update-owner").props.value, `staff-${data.user.id}`); assert.equal(field("group-update-time").props.disabled, true); assert.equal(field("group-update-duration").props.value, "45");
    const controls = nodes(view.render()).filter(node => ["Input", "RecordPicker"].includes(node.type));
    assert.equal(new Set(controls.map(node => node.props.id)).size, controls.length); assert.equal(writes.length, 0); view.unmount();
});

test("a preserved group update remains exact when administrator access changes", async () => {
    const data = fixture(), entries = new Map(), requests = [];
    let success = false;
    const key = maintenance.groupMaintenanceKey(data.user.id, "demo");
    const storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) };
    const view = await mount("components/inventory/group-maintenance-dialog.tsx", "GroupMaintenanceDialog", {
        data, group: data.teachingGroups[0], ids: ["BAT-1"], onClose() {}, onChanged: async () => {},
        async write(action, payload) {
            requests.push(structuredClone(payload));
            if (data.user.role !== "admin") throw new Error("Only administrators can maintain saved records.");
            if (!success) throw new Error("Response interrupted");
            return groupReceipt(data, payload);
        },
    }, { sessionStorage: storage, window: { dispatchEvent() {} } });
    nodes(view.render()).find(node => node.type === "RecordPicker").props.onChange(`staff-${data.user.id}`);
    await button(view.render(), "Confirm update (1)").props.onClick();
    const preserved = entries.get(key);
    assert.ok(preserved);
    data.user.role = "staff";
    assert.match(text(view.render()), /New group updates require administrator access/);
    assert.equal(button(view.render(), "Retry exact group operation").props.disabled, false);
    assert.equal(button(view.render(), "Confirm update (1)"), undefined);
    await button(view.render(), "Retry exact group operation").props.onClick();
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1], requests[0]);
    assert.equal(entries.get(key), preserved);
    assert.match(text(view.render()), /Only administrators can maintain saved records/);
    data.user.role = "admin";
    success = true;
    assert.equal(button(view.render(), "Retry exact group operation").props.disabled, false);
    await button(view.render(), "Retry exact group operation").props.onClick();
    assert.deepEqual(requests[2], requests[0]);
    assert.equal(entries.size, 0);
    view.unmount();
});

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
    const functionNames = ["showWorkspace", "openTeachingGroups", "returnFromTeachingGroups"];
    const valueNames = ["personalScope", "inventoryView", "inventorySourceView", "retainInventory", "inventoryPersonalScope"];
    const statements = app.body.statements.filter(node => ts.isFunctionDeclaration(node) ? functionNames.includes(node.name?.text) : ts.isVariableStatement(node) && node.declarationList.declarations.some(value => valueNames.includes(value.name.getText(file))));
    const code = ts.transpileModule(statements.map(node => node.getText(file)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    function render(state) {
        const effects = state.navigationEffects ??= [];
        const context = {
            interceptPendingTeachingCheckout: () => !!state.pendingTeaching,
            transitionWorkspace: (update, cadence) => { effects.push(["transition", cadence]); update(); },
            window: { scrollTo: options => effects.push(["scroll", options]) },
            document: { getElementById: id => ({ focus: options => effects.push(["focus", id, options]) }) },
            permissions: getRolePermissions(state.user.role), view: state.view, modalOpen: state.modalOpen,
            groupsReturnView: state.groupsReturnView, user: state.user, setView: value => state.view = value,
            setGroupsReturnView: value => state.groupsReturnView = value, setActiveGroupId: value => state.activeGroupId = value,
        };
        const names = Object.keys(context);
        return new Function(...names, `${code}\nreturn { openTeachingGroups, returnFromTeachingGroups, personalScope, inventoryView, retainInventory, inventoryPersonalScope };`)(...names.map(name => context[name]));
    }
    for (const [source, scope] of [["inventory", "all"], ["my-batteries", "responsible"], ["my-loans", "borrowed"], ["activity", null], ["messages", null]]) {
        const state = { view: source, groupsReturnView: "inventory", modalOpen: false, user: { role: "staff" }, activeGroupId: "Old group" };
        const before = render(state); before.openTeachingGroups();
        assert.equal(state.view, "teaching-groups"); assert.equal(state.groupsReturnView, source); assert.equal(state.activeGroupId, null);
        assert.deepEqual(state.navigationEffects, [["transition", "navigation"], ["scroll", { top: 0, behavior: "instant" }], ["focus", "workspace-content", { preventScroll: true }]]);
        const groups = render(state); assert.equal(groups.inventoryView, false); assert.equal(groups.personalScope, "all"); assert.equal(groups.retainInventory, scope !== null);
        if (scope !== null) assert.equal(groups.inventoryPersonalScope, before.inventoryPersonalScope);
        groups.openTeachingGroups(); assert.equal(state.groupsReturnView, source); assert.equal(state.navigationEffects.length, 3);
        state.modalOpen = true; render(state).returnFromTeachingGroups(); assert.equal(state.view, "teaching-groups"); assert.equal(state.navigationEffects.length, 3);
        state.modalOpen = false; render(state).returnFromTeachingGroups(); assert.equal(state.view, source);
        assert.equal(state.navigationEffects.length, 6, "Returning to another workspace restores its heading and focus");
        if (scope !== null) assert.equal(render(state).inventoryPersonalScope, scope);
    }
    const locked = { view: "inventory", groupsReturnView: "my-batteries", modalOpen: true, user: { role: "staff" }, activeGroupId: "Current group" };
    render(locked).openTeachingGroups(); assert.equal(locked.view, "inventory"); assert.equal(locked.activeGroupId, "Current group"); assert.deepEqual(locked.navigationEffects, []);
    const pending = { view: "inventory", groupsReturnView: "my-batteries", modalOpen: false, pendingTeaching: true, user: { role: "staff" }, activeGroupId: "Current group" };
    render(pending).openTeachingGroups(); assert.equal(pending.view, "inventory"); assert.equal(pending.activeGroupId, "Current group"); assert.deepEqual(pending.navigationEffects, []);
    const demoted = { view: "teaching-groups", groupsReturnView: "accounts", modalOpen: false, user: { role: "staff" } };
    render(demoted).returnFromTeachingGroups(); assert.equal(demoted.view, "inventory");
});

test("explicit workspace navigation restores heading focus once and preserves modal and recovery gates", async () => {
    const file = ts.createSourceFile("inventory-app.tsx", await readFile("app/inventory-app.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const app = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "InventoryApp");
    const statements = app.body.statements.filter(node => ts.isFunctionDeclaration(node) && ["showWorkspace", "openAssets", "startScan"].includes(node.name?.text));
    function handler(component, name) {
        let expression;
        const visit = node => {
            if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(file) === component) {
                const attribute = node.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(file) === name);
                if (attribute && ts.isJsxExpression(attribute.initializer)) expression = attribute.initializer.expression.getText(file);
            }
            ts.forEachChild(node, visit);
        };
        visit(app);
        assert.ok(expression, `${component}.${name} must remain an actual page handler`);
        return expression;
    }
    const source = `${statements.map(node => node.getText(file)).join("\n")}\nconst navigate = ${handler("ApplicationShell", "onNavigate")};\nconst groupActivity = ${handler("TeachingGroupsWorkspace", "onActivity")};`;
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    function render(state) {
        const effects = state.effects ??= [];
        const bindings = {
            view: state.view, modalOpen: state.modalOpen,
            interceptPendingTeachingCheckout: () => !!state.pendingTeaching,
            interceptPendingWorkflow: () => !!state.pendingWorkflow,
            transitionWorkspace: (update, cadence) => { effects.push(["transition", cadence]); update(); },
            window: { scrollTo: options => effects.push(["scroll", state.view, options]) },
            document: { getElementById: id => ({ focus: options => effects.push(["focus", state.view, id, options]) }) },
            setView: next => { state.view = next; }, setActivityGroupId: id => { state.activityGroupId = id; },
            setGroupRemoval: next => { state.groupRemoval = next; }, setNotice: next => { state.notice = next; },
            setScan: next => { state.scan = next; },
        };
        return new Function(...Object.keys(bindings), `${code}\nreturn { navigate, groupActivity, openAssets, startScan };`)(...Object.values(bindings));
    }
    const state = { view: "inventory", modalOpen: false, notice: "Current note", groupRemoval: "Previous group removal" };
    render(state).navigate("activity");
    assert.equal(state.view, "activity");
    assert.deepEqual(state.effects, [["transition", "navigation"], ["scroll", "activity", { top: 0, behavior: "instant" }], ["focus", "activity", "workspace-content", { preventScroll: true }]]);
    render(state).navigate("activity");
    assert.equal(state.effects.length, 3, "Selecting the current destination leaves reading position unchanged");
    state.modalOpen = true;
    render(state).navigate("inventory"); render(state).openAssets(); render(state).startScan("checkout");
    assert.equal(state.view, "activity"); assert.equal(state.scan, undefined); assert.equal(state.groupRemoval, "Previous group removal"); assert.equal(state.effects.length, 3);
    state.modalOpen = false; state.pendingTeaching = true; state.pendingWorkflow = true;
    render(state).navigate("inventory"); render(state).openAssets(); render(state).startScan("checkout");
    assert.equal(state.view, "activity"); assert.equal(state.scan, undefined); assert.equal(state.effects.length, 3);
    state.pendingTeaching = false; state.pendingWorkflow = false;
    render(state).openAssets();
    assert.equal(state.view, "assets"); assert.equal(state.groupRemoval, null); assert.equal(state.effects.length, 6);
    render(state).openAssets(); assert.equal(state.effects.length, 6);
    state.view = "teaching-groups";
    render(state).groupActivity({ id: "historic-group", version: 7 });
    assert.equal(state.view, "activity"); assert.equal(state.activityGroupId, "historic-group"); assert.equal(state.effects.length, 9);
    render(state).startScan("return");
    assert.equal(state.scan.kind, "return"); assert.equal(state.effects.length, 12);
});

test("inventory filtering and pagination preserve reading position and selected records", async () => {
    const data = fixture(), navigationEffects = [], transitions = [];
    data.batteries = Array.from({ length: 32 }, (_, index) => ({ ...data.batteries[0], id: `BAT-${String(index + 1).padStart(3, "0")}`, name: `Battery ${index + 1}` }));
    const view = await mount("components/inventory/inventory-table.tsx", "InventoryTable", {
        data, ready: true, onMovement() {}, onEdit() {}, onDetail() {}, onSetup() {}, onExport() {},
    }, {
        appliedFilterChips: () => [],
        transitionWorkspace: (update, cadence) => { transitions.push(cadence ?? "frequent"); update(); },
        window: { scrollTo: options => navigationEffects.push(["scroll", options]) },
        document: { getElementById: id => ({ focus: options => navigationEffects.push(["focus", id, options]) }) },
    });
    const row = tree => nodes(tree).find(node => node.type === "TableRow" && node.key === "BAT-001");
    nodes(row(view.render())).find(node => node.type === "Checkbox").props.onCheckedChange(true);
    assert.equal(button(view.render(), "Next").props.disabled, false);
    button(view.render(), "Next").props.onClick();
    assert.match(text(view.render()), /Page 2 of 2/);
    nodes(view.render()).find(node => node.type === "InventoryFilterPanel").props.onChange({ search: "Battery 1" });
    assert.match(text(view.render()), /Page 1 of 1/);
    nodes(view.render()).find(node => node.type === "AppliedFilters").props.onClear();
    assert.match(text(view.render()), /Page 1 of 2/);
    assert.equal(row(view.render()).props["aria-selected"], true);
    assert.deepEqual(transitions, ["frequent", "frequent", "frequent"]);
    assert.deepEqual(navigationEffects, [], "Ordinary list changes do not reset workspace scroll or focus");
    view.unmount();
});

test("group inventory keeps its membership boundary when clearing filters and offers batch maintenance and retired history",async()=>{
    const data=fixture(),calls=[],exports=[];
    const source=ts.transpileModule(await readFile("components/inventory/inventory-filter-panel.tsx","utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/^import .*;\r?\n/gm,"").replace(/^export /gm,"");
    const bindings={...ui,...query,...client,...locations},names=Object.keys(bindings),chips=new Function(...names,"_jsx","_jsxs","_Fragment",`${source}\nreturn appliedFilterChips;`)(...names.map(n=>bindings[n]),jsx,jsx,"Fragment");
    const view=await mount("components/inventory/inventory-table.tsx","InventoryTable",{data,group:data.teachingGroups[0],ready:true,onMovement:(...args)=>calls.push(args),onRemoval:ids=>calls.push(["removal",ids]),onGroupMaintenance:ids=>calls.push(["update",ids]),onEdit(){},onDetail(){},onSetup(){},onExport:value=>exports.push(value)}, {appliedFilterChips:chips});
    assert.match(text(nodes(view.render()).find(node => node.props["aria-label"] === "Inventory totals")), /2Active batteriesIn this teaching group/);
    assert.match(text(view.render()), /2 active batteries in this scope/);
    assert.ok(nodes(view.render()).some(node => node.type === "TableRow" && node.props["aria-selected"] !== undefined && /Battery 3/.test(text(node)) && /Scrapped/.test(text(node))), "Retired members stay visible outside the explicitly active totals");
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
    const view=await mount("components/inventory/activity-history.tsx","ActivityHistory",{data,onDetail(){},scope:"all",revision:0,groupId:group.id,onGroupFilterChange:id=>groupChanges.push(id)},{fetch:async()=>({ok:true,json:async()=>({events})})});view.render();await new Promise(resolve=>setImmediate(resolve));assert.match(text(view.render()),/1 matching operation/);assert.match(text(view.render()),/View 2 recorded battery actions/);
    const selector=nodes(view.render()).find(n=>n.type==="Checkbox"&&String(n.props["aria-label"]).startsWith("Select activity group:"));selector.props.onCheckedChange(true);input(view.render(),"Search activity").props.onChange({target:{value:"No match"}});button(view.render(),"Clear filters").props.onClick();assert.deepEqual(groupChanges,[null]);assert.match(text(view.render()),/1 operations selected/);button(view.render(),"Download selected activity").props.onClick();const download=nodes(view.render()).find(n=>n.type==="ActivityExportDialog");assert.equal(download.props.selectedIds.length,1);assert.equal(download.props.groupId,group.id);assert.equal(download.props.scope,"all");view.unmount();
});
test("Activity selection controls keep their current IDs while opening and become inactive when the last selection clears", async () => {
    const data = fixture(), group = data.teachingGroups[0], operationId = crypto.randomUUID();
    const evidence = { id: group.id, version: 1, name: group.name, ownerAccountId: data.user.id, operationId, batteryIds: ["BAT-1"] };
    const events = [{ id: crypto.randomUUID(), action: "checkout", batteryId: "BAT-1", actorName: "Teacher", at, details: { requestId: operationId, teachingGroup: evidence, borrower: "Teacher", source: "Manual selection" } }];
    const view = await mount("components/inventory/activity-history.tsx", "ActivityHistory", { data, onDetail() {} }, { fetch: async () => ({ ok: true, json: async () => ({ events }) }) });
    view.render(); await new Promise(resolve => setImmediate(resolve));
    const toolbar = () => nodes(view.render()).find(node => node.type === "MotionDisclosure" && nodes(node).some(child => child.props.className === "selection-toolbar"));
    assert.equal(toolbar().props.open, false); assert.equal(button(view.render(), "Download selected activity").props.disabled, true);
    nodes(view.render()).find(node => node.type === "Checkbox" && String(node.props["aria-label"]).startsWith("Select activity group:")).props.onCheckedChange(true);
    assert.equal(toolbar().props.open, true); assert.equal(button(view.render(), "Download selected activity").props.disabled, false); assert.match(text(toolbar()), /1 operations selected/);
    button(view.render(), "Clear selection").props.onClick();
    assert.equal(toolbar().props.open, false); assert.equal(button(view.render(), "Download selected activity").props.disabled, true); assert.equal(button(view.render(), "Clear selection").props.disabled, true); view.unmount();
});

test("activity download supports group summaries or selective battery data and avoids CSV truncation of detail tables",async()=>{
    const downloads=[],view=await mount("components/inventory/activity-export-dialog.tsx","ActivityExportDialog",{dataset:"demo",scope:"mine",search:"Class",groupId:null,selectedIds:["group:some-event"],count:4,onClose(){}},{downloadExportAttachment:async(...args)=>downloads.push(args)});
    select(view.render(),"Activity file format").props.onValueChange("csv");select(view.render(),"Activity information depth").props.onValueChange("battery_details");assert.equal(select(view.render(),"Activity file format").props.value,"xlsx");
    nodes(view.render()).find(n=>n.type==="Checkbox").props.onCheckedChange(false);assert.equal(button(view.render(),"Download activity").props.disabled,true);const section=nodes(view.render()).find(n=>n.type==="label"&&text(n).includes("Complete loan history"));nodes(section).find(n=>n.type==="Checkbox").props.onCheckedChange(true);
    await button(view.render(),"Download activity").props.onClick();assert.equal(downloads[0][0].activityDepth,"battery_details");assert.deepEqual(downloads[0][0].activityIds,["group:some-event"]);assert.deepEqual(downloads[0][0].sections,["loans"]);assert.equal(downloads[0][1],"xlsx");view.unmount();
});

test("My activity uses current battery state for guarded movements, not the historic action", async () => {
    const data = fixture(), movements = [];
    data.user.role = "staff";
    data.batteries[1].borrowerAccountId = "another-staff";
    const events = [
        { id: "old-checkout", action: "checkout", batteryId: "BAT-1", actorName: "Teacher", at, details: {} },
        { id: "old-return", action: "return", batteryId: "BAT-2", actorName: "Teacher", at, details: {} },
        { id: "retired", action: "battery_scrapped", batteryId: "BAT-3", actorName: "Teacher", at, details: {} },
        { id: "missing", action: "checkout", batteryId: "UNAVAILABLE", actorName: "Teacher", at, details: {} },
        { id: "account-event", action: "message_read", batteryId: null, actorName: "Teacher", at, details: {} },
    ];
    const requests = [];
    const view = await mount("components/inventory/activity-history.tsx", "ActivityHistory", {
        data, scope: "mine", ready: true, onDetail() {}, onMovement: (...args) => movements.push(args),
    }, { fetch: async url => { requests.push(url); return { ok: true, json: async () => ({ events }) }; } });
    view.render(); await new Promise(resolve => setImmediate(resolve));
    const tree = view.render();
    assert.match(requests[0], /activityScope=mine/);
    assert.match(text(tree), /CURRENT STATUS \/ ACTION/);
    const controls = nodes(tree).filter(node => node.props?.["aria-label"]?.startsWith("Current status and actions"));
    assert.match(text(controls[0]), /In store/);
    assert.match(text(controls[1]), /In use/);
    assert.match(text(controls[2]), /Scrapped/);
    assert.match(text(tree), /Current status unavailable/);
    const checkout = nodes(tree).find(node => node.props?.["aria-label"] === "Check out BAT-1");
    const checkin = nodes(tree).find(node => node.props?.["aria-label"] === "Check in BAT-2");
    checkout.props.onClick(); checkin.props.onClick();
    assert.deepEqual(movements, [["checkout", ["BAT-1"]], ["return", ["BAT-2"]]]);
    assert.equal(nodes(tree).filter(node => node.type === "Button" && /^Check (in|out) /.test(node.props["aria-label"] ?? "")).length, 2);
    view.props.ready = false;
    assert.equal(button(view.render(), "Check out"), undefined);
    assert.match(text(view.render()), /Current status unavailable/);
    view.props.ready = true;
    data.batteries = data.batteries.map(battery => battery.id === "BAT-1" ? { ...battery, loanId: "new-loan" } : battery);
    assert.ok(nodes(view.render()).find(node => node.props?.["aria-label"] === "Check in BAT-1"));
    view.unmount();
});

test("My activity can move a recorded group member without reusing historic group membership", async () => {
    const data = fixture(), movements = [];
    data.user.role = "staff";
    const group = data.teachingGroups[0], operationId = crypto.randomUUID();
    const evidence = { id: group.id, version: 1, name: group.name, ownerAccountId: data.user.id, operationId, batteryIds: ["BAT-1", "BAT-2"] };
    const events = ["BAT-1", "BAT-2"].map(id => ({ id: crypto.randomUUID(), action: "checkout", batteryId: id, actorName: "Teacher", at, details: { teachingGroup: evidence } }));
    data.teachingGroups = [];
    const view = await mount("components/inventory/activity-history.tsx", "ActivityHistory", {
        data, scope: "mine", ready: true, onDetail() {}, onMovement: (...args) => movements.push(args),
    }, { fetch: async () => ({ ok: true, json: async () => ({ events }) }) });
    view.render(); await new Promise(resolve => setImmediate(resolve));
    const tree = view.render();
    assert.match(text(tree), /View 2 recorded battery actions/);
    assert.match(text(tree), /Current battery status/);
    nodes(tree).find(node => node.props?.["aria-label"] === "Check in BAT-2").props.onClick();
    assert.deepEqual(movements, [["return", ["BAT-2"]]]);
    view.unmount();
});

test("shared Activity stays a history view and My activity with failed history exposes no movement", async () => {
    for (const [scope, ok] of [["all", true], ["mine", false]]) {
        const data = fixture(), events = [{ id: "history", action: "checkout", batteryId: "BAT-1", actorName: "Teacher", at, details: {} }];
        const view = await mount("components/inventory/activity-history.tsx", "ActivityHistory", {
            data, scope, ready: true, onDetail() {}, onMovement() { throw new Error("Unexpected movement"); },
        }, { fetch: async () => ({ ok, json: async () => ({ events, error: ok ? undefined : "History unavailable" }) }) });
        view.render(); await new Promise(resolve => setImmediate(resolve));
        assert.equal(button(view.render(), "Check out"), undefined);
        if (!ok) assert.match(text(view.render()), /History unavailable/);
        view.unmount();
    }
});
test("a refreshed group membership blocks an old outside selection until the teacher explicitly removes it", async () => {
    const data = fixture(), exports = [];
    const source = ts.transpileModule(await readFile("components/inventory/inventory-filter-panel.tsx", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
    const bindings = { getRolePermissions, ...ui, ...query, ...client, ...locations }, names = Object.keys(bindings);
    const chips = new Function(...names, "_jsx", "_jsxs", "_Fragment", `${source}\nreturn appliedFilterChips;`)(...names.map(name => bindings[name]), jsx, jsx, "Fragment");
    const view = await mount("components/inventory/inventory-table.tsx", "InventoryTable", { data, group: data.teachingGroups[0], ready: true, onMovement() {}, onEdit() {}, onDetail() {}, onSetup() {}, onExport: value => exports.push(value) }, { appliedFilterChips: chips });
    button(view.render(), "Select all group members").props.onClick();
    data.teachingGroups[0] = { ...data.teachingGroups[0], batteryIds: ["BAT-1"], version: 2 };
    view.props.group = data.teachingGroups[0];
    assert.match(text(view.render()), /no longer belong to this teaching group/);
    assert.equal(button(view.render(), "Download selected").props.disabled, true);
    button(view.render(), "Remove batteries outside this view").props.onClick();
    button(view.render(), "Download selected").props.onClick();
    assert.deepEqual(exports[0].selectedIds, ["BAT-1"]);
    assert.deepEqual(exports[0].teachingGroup, { id: data.teachingGroups[0].id, version: 2 });
    view.unmount();
});

test("opened-group download conflicts retain the captured IDs, version and information choices until explicit review", async () => {
    const data = fixture(), group = data.teachingGroups[0], requests = [], closed = [];
    const draft = { selectedIds: ["BAT-1", "BAT-2"], teachingGroup: { id: group.id, version: group.version }, filter: { ...query.defaultInventoryFilter(), groupId: group.id, lifecycle: "all" }, page: 0, pageSize: "25", matching: 3, pageCount: 3 };
    const view = await mount("components/inventory/export-dialog.tsx", "ExportDialog", { draft, dataset: "demo", onClose: () => closed.push(true) }, {
        downloadExportAttachment: async input => { requests.push(structuredClone(input)); throw new Error("This teaching group changed. No partial download was prepared."); },
    });
    select(view.render(), "Export information depth").props.onValueChange("detail");
    nodes(view.render()).find(node => node.type === "Checkbox").props.onCheckedChange(false);
    const loans = nodes(view.render()).find(node => node.type === "label" && text(node).includes("Complete loan history"));
    nodes(loans).find(node => node.type === "Checkbox").props.onCheckedChange(true);
    data.teachingGroups[0] = { ...group, version: 2, batteryIds: ["BAT-2"] };
    await button(view.render(), "Download").props.onClick();
    assert.equal(closed.length, 0);
    assert.match(text(view.render()), /This teaching group changed/);
    assert.match(text(view.render()), /BAT-1, BAT-2/);
    assert.deepEqual(requests[0].batteryIds, ["BAT-1", "BAT-2"]);
    assert.deepEqual(requests[0].teachingGroup, { id: group.id, version: 1 });
    assert.deepEqual(requests[0].sections, ["loans"]);
    assert.equal(button(view.render(), "Download").props.disabled, false);
    await button(view.render(), "Download").props.onClick();
    assert.deepEqual(requests[1], requests[0], "No automatic replacement with the new group's members or version");
    view.unmount();
});

test("the layered inventory preserves the recorded nominal-voltage meaning", async () => {
    const data = fixture();
    data.batteries[0].voltage = 11.1;
    const view = await mount("components/inventory/inventory-table.tsx", "InventoryTable", { data, ready: true, onMovement() {}, onEdit() {}, onDetail() {}, onSetup() {}, onExport() {} }, { appliedFilterChips: () => [] });
    assert.match(text(view.render()), /Nominal voltage11\.1 V/);
    assert.doesNotMatch(text(view.render()), /Rated voltage/);
    view.unmount();
});


test("Activity shares current battery criteria while retaining whole original groups, unavailable history and selected operations", async () => {
    const data = fixture(), group = data.teachingGroups[0], operationId = crypto.randomUUID();
    const evidence = { id: group.id, version: 1, name: group.name, ownerAccountId: data.user.id, operationId, batteryIds: ["BAT-1", "BAT-2"] };
    const events = [
        ...["BAT-1", "BAT-2"].map(id => ({ id: `group-${id}`, action: "checkout", batteryId: id, actorName: "Teacher", at, details: { teachingGroup: evidence } })),
        { id: "retired", action: "battery_scrapped", batteryId: "BAT-3", actorName: "Teacher", at, details: {} },
        { id: "unavailable", action: "checkout", batteryId: "OLD-BATTERY", actorName: "Teacher", at, details: {} },
        { id: "directory", action: "records_imported", batteryId: null, actorName: "Teacher", at, details: {} },
    ];
    const view = await mount("components/inventory/activity-history.tsx", "ActivityHistory", { data, scope: "mine", ready: true, onDetail() {} }, { fetch: async () => ({ ok: true, json: async () => ({ events }) }) });
    view.render(); await new Promise(resolve => setImmediate(resolve));
    const controls = () => nodes(view.render()).find(node => node.type === "BatteryFilterControls");
    assert.equal(controls().props.defaultLifecycle, "all");
    assert.equal(controls().props.showSort, false);
    assert.match(controls().props.scopeNote, /current register.*historical operations/i);
    assert.match(text(view.render()), /4 matching operations/);
    controls().props.onChange({ search: "   " });
    assert.match(text(view.render()), /4 matching operations/);
    controls().props.onChange({ status: "out" });
    assert.match(text(view.render()), /1 matching operation/);
    assert.match(text(view.render()), /View 2 recorded battery actions/);
    nodes(view.render()).find(node => node.type === "Checkbox" && node.props["aria-label"] === "Select activity group:group-BAT-1").props.onCheckedChange(true);
    controls().props.onChange({ chemistry: "No matching chemistry" });
    assert.match(text(view.render()), /0 matching operations/);
    assert.match(text(view.render()), /1 operations selected/);
    controls().props.onClear();
    assert.match(text(view.render()), /4 matching operations/);
    assert.match(text(view.render()), /1 operations selected/);
    controls().props.onChange({ capacityMinMah: 2000, capacityMaxMah: 1000 });
    assert.match(text(view.render()), /maximum must be at least the minimum/);
    assert.match(text(view.render()), /0 matching operations/);
    controls().props.onClear();
    controls().props.onChange({ groupId: crypto.randomUUID() });
    assert.match(text(view.render()), /teaching group is no longer available/);
    controls().props.onClear();
    controls().props.onChange({ lifecycle: "scrapped" });
    assert.match(text(view.render()), /1 matching operation/);
    assert.ok(nodes(view.render()).some(node => node.type === "Checkbox" && node.props["aria-label"] === "Select activity retired"));
    button(view.render(), "Download selected activity").props.onClick();
    const dialog = nodes(view.render()).find(node => node.type === "ActivityExportDialog");
    assert.equal(dialog.props.batteryFilter.lifecycle, "scrapped");
    assert.deepEqual(dialog.props.selectedIds, ["group:group-BAT-1"]);
    assert.equal(dialog.props.scope, "mine");
    view.unmount();
});

test("Activity export captures current battery criteria with historical search and own scope when opened", async () => {
    const downloads = [], filters = { ...query.defaultInventoryFilter(), lifecycle: "all", status: "out", ageMode: "unknown" };
    const view = await mount("components/inventory/activity-export-dialog.tsx", "ActivityExportDialog", { dataset: "demo", scope: "mine", search: "checkout", groupId: null, selectedIds: [], count: 3, batteryFilter: filters, onClose() {} }, { downloadExportAttachment: async (...args) => downloads.push(args) });
    view.render();
    view.props.batteryFilter = { ...filters, status: "in" };
    view.props.search = "new search";
    view.props.count = 99;
    assert.match(text(view.render()), /All filtered operations \(3\)/);
    await button(view.render(), "Download activity").props.onClick();
    assert.deepEqual(downloads[0][0].activityBatteryFilter, filters);
    assert.equal(downloads[0][0].search, "checkout");
    assert.equal(downloads[0][0].activityScope, "mine");
    assert.equal(downloads[0][0].activityIds, undefined);
    view.unmount();
});


test("Activity row selection supports plain content while keeping controls, expansion, dragging and unavailable state independent", async () => {
    const data = fixture(), event = { id: "row-checkout", action: "checkout", batteryId: "BAT-1", actorName: "Teacher", at, details: {} };
    const oldElement = globalThis.Element, oldWindow = globalThis.window;
    let selection = null;
    class TestElement {
        constructor(interactive = false) { this.interactive = interactive; }
        closest(selector) { assert.match(selector, /summary/); assert.match(selector, /role="checkbox"/); return this.interactive ? this : null; }
    }
    globalThis.Element = TestElement;
    globalThis.window = { getSelection: () => selection };
    const view = await mount("components/inventory/activity-history.tsx", "ActivityHistory", { data, scope: "mine", ready: true, onDetail() {}, onMovement() {} }, { fetch: async () => ({ ok: true, json: async () => ({ events: [event] }) }) });
    try {
        view.render(); await new Promise(resolve => setImmediate(resolve));
        const row = () => nodes(view.render()).find(node => node.type === "TableRow" && node.key === event.id);
        const click = (interactive = false, extra = {}) => row().props.onClick({ target: new TestElement(interactive), currentTarget: { contains: () => true }, button: 0, defaultPrevented: false, ...extra });
        click();
        assert.equal(row().props["aria-selected"], true);
        assert.equal(row().props["data-selected"], true);
        click(true);
        assert.equal(row().props["aria-selected"], true);
        const checkbox = nodes(row()).find(node => node.type === "Checkbox");
        checkbox.props.onCheckedChange(false);
        click(true);
        assert.equal(row().props["aria-selected"], false, "Checkbox bubbling must not double-toggle");
        selection = { isCollapsed: false, anchorNode: {}, focusNode: {} };
        click();
        assert.equal(row().props["aria-selected"], false);
        selection = null;
        click(false, { defaultPrevented: true });
        click(false, { button: 2 });
        assert.equal(row().props["aria-selected"], false);
        view.props.ready = false;
        click();
        nodes(row()).find(node => node.type === "Checkbox").props.onCheckedChange(true);
        assert.equal(row().props["aria-selected"], false);
        assert.equal(row().props["data-selectable"], false);
        view.props.ready = true;
        click(); click();
        assert.equal(row().props["aria-selected"], false, "Repeated deliberate clicks toggle the selected state");
    } finally {
        view.unmount();
        if (oldElement === undefined) delete globalThis.Element; else globalThis.Element = oldElement;
        if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    }
});
