import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { getRolePermissions } from "../work/qa/permissions.mjs";
import { isActiveBattery } from "../work/qa/battery-lifecycle.mjs";

// Render the actual role-aware components and local navigation handlers with
// inert UI primitives. Browser layout and native disabled behavior are separate checks.
const primitiveNames = [
  "Battery", "Package", "ScanLine", "MapIcon", "RotateCcw", "ClipboardList", "Settings2",
  "UserRound", "Users", "LogOut", "CalendarDays", "Mail", "FlaskConical", "ChevronLeft", "Button",
  "SidebarProvider", "Sidebar", "SidebarHeader", "SidebarContent", "SidebarGroup",
  "SidebarGroupLabel", "SidebarMenu", "SidebarMenuItem", "SidebarMenuButton",
  "SidebarFooter", "SidebarInset", "SidebarTrigger", "WorkspaceMotion",
];
const primitives = Object.fromEntries(primitiveNames.map(name => [name, name]));
const jsx = (type, props, key) => typeof type === "function"
  ? type(props ?? {})
  : { type, props: props ?? {}, key };

async function compile(file, exportName) {
  const source = ts.transpileModule(await readFile(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
  return extra => {
    const bindings = { ...primitives, getRolePermissions, isActiveBattery, signOut: async () => {}, useRef: value => ({ current: value }), useLayoutEffect() {}, spring() {}, ...extra };
    const names = Object.keys(bindings);
    return new Function(...names, "_jsx", "_jsxs", `${source}\nreturn ${exportName};`)(
      ...names.map(name => bindings[name]), jsx, jsx,
    );
  };
}
const shellFactory = await compile("../components/application/application-shell.tsx", "ApplicationShell");
const headingFactory = await compile("../components/application/workspace-heading.tsx", "WorkspaceHeading");

function nodes(node, result = []) {
  if (Array.isArray(node)) node.forEach(child => nodes(child, result));
  else if (node && typeof node === "object") {
    result.push(node);
    nodes(node.props?.children, result);
  }
  return result;
}
function text(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return node && typeof node === "object" ? text(node.props?.children) : "";
}
const navigation = tree => nodes(tree).filter(node => node.type === "SidebarMenuButton");
const nav = (tree, label) => navigation(tree).find(node => text(node) === label);
const button = (tree, label) => nodes(tree).find(node => node.type === "Button" && text(node) === label);
const group = (tree, label) => nodes(tree).find(node => node.type === "SidebarGroup" &&
  nodes(node).some(child => child.type === "SidebarGroupLabel" && text(child) === label));
const groupLabels = tree => nodes(tree).filter(node => node.type === "SidebarGroupLabel").map(text);

function shell(role = "staff", overrides = {}, mobile = false, collapsed = false) {
  const events = [];
  const props = {
    children: "Workspace content",
    user: { id: "staff-one", username: "staff.one", displayName: "Staff One", role },
    data: { batteries: [] },
    view: "inventory", scan: null, intake: false, locked: false, ready: true, unreadCount: 2,
    onNavigate: view => events.push(["navigate", view]),
    onTeachingGroups: () => events.push(["teaching-groups"]),
    onAssets: () => events.push(["assets"]),
    onScan: kind => events.push(["scan", kind]),
    onError: message => events.push(["error", message]),
    ...overrides,
  };
  const ApplicationShell = shellFactory({
    useSidebar: () => ({ isMobile: mobile, open: !collapsed, setOpenMobile: open => events.push(["mobile", open]), toggleSidebar: () => { collapsed = !collapsed; events.push(["sidebar", !collapsed]); } }),
  });
  return { props, events, render: () => ApplicationShell(props) };
}
const WorkspaceHeading = headingFactory({});
function heading(role, view, extra = {}) {
  return WorkspaceHeading({ role, view, scan: null, intake: false, ready: true, onScan() {}, ...extra });
}

test("staff navigation keeps shared and personal work without exposing administration destinations", () => {
  const tree = shell().render();
  assert.deepEqual(groupLabels(tree), ["WORKSPACE", "MY WORK"]);
  for (const label of ["Battery inventory", "Mapping", "Teaching groups", "Intake & removal", "Scan checkout", "Scan return", "Activity history", "Recurring tasks", "Directories"]) {
    assert.ok(nav(group(tree, "WORKSPACE"), label), `${label} remains available to staff`);
  }
  for (const label of ["My batteries", "My batteries in use", "My activity", "Messages", "My account"]) {
    assert.ok(navigation(group(tree, "MY WORK")).some(node =>
      nodes(node).some(child => child.type === "span" && text(child) === label)), `${label} remains personal`);
  }
  assert.equal(nav(tree, "Manage records"), undefined);
  assert.equal(nav(tree, "Staff accounts"), undefined);
  assert.equal(group(tree, "ADMINISTRATION"), undefined);
});

test("administrator record and account controls form a separate section while My account remains personal", () => {
  const tree = shell("admin").render();
  assert.deepEqual(groupLabels(tree), ["WORKSPACE", "MY WORK", "ADMINISTRATION"]);
  assert.deepEqual(navigation(group(tree, "ADMINISTRATION")).map(text), ["Manage records", "Staff accounts"]);
  assert.equal(nav(group(tree, "WORKSPACE"), "Manage records"), undefined);
  assert.equal(nav(tree, "Directories"), undefined);
  assert.ok(nav(group(tree, "MY WORK"), "My account"));
  assert.ok(nav(group(tree, "WORKSPACE"), "Recurring tasks"));
});

test("a refreshed staff role removes administrator navigation on the next render", () => {
  const view = shell("admin", { view: "manage" });
  assert.equal(nav(view.render(), "Manage records").props.isActive, true);
  view.props.user = { ...view.props.user, role: "staff" };
  const tree = view.render();
  assert.equal(group(tree, "ADMINISTRATION"), undefined);
  assert.equal(nav(tree, "Staff accounts"), undefined);
  assert.equal(nav(tree, "Directories").props.isActive, true);
  assert.equal(navigation(tree).filter(node => node.props.isActive).length, 1);
});

test("mobile navigation dismisses the drawer before dispatching the original view or workflow action", () => {
  const view = shell("staff", {}, true);
  for (const [label, expected] of [
    ["Mapping", ["navigate", "mapping"]],
    ["Directories", ["navigate", "manage"]],
    ["My account", ["navigate", "account"]],
    ["Teaching groups", ["teaching-groups"]],
    ["Intake & removal", ["assets"]],
    ["Scan return", ["scan", "return"]],
  ]) {
    view.events.length = 0;
    nav(view.render(), label).props.onClick({});
    assert.deepEqual(view.events, [["mobile", false], expected]);
  }
  const desktop = shell("admin");
  nav(desktop.render(), "Staff accounts").props.onClick({});
  assert.deepEqual(desktop.events, [["navigate", "accounts"]]);
});

test("workflow locks cover both roles and unready inventory disables movement and intake entry points", () => {
  for (const role of ["staff", "admin"]) {
    const locked = shell(role, { locked: true }).render();
    assert.ok(navigation(locked).every(node => node.props.disabled === true));
    assert.equal(button(locked, "Sign out").props.disabled, true);
    const loading = shell(role, { ready: false, data: null }).render();
    for (const label of ["Intake & removal", "Scan checkout", "Scan return"]) {
      assert.equal(nav(loading, label).props.disabled, true);
    }
    assert.equal(nav(loading, "Battery inventory").props.disabled, false);
    assert.equal(nav(loading, "My account").props.disabled, false);
  }
});

test("scan and intake replace the old destination highlight including a retained personal view", () => {
  for (const role of ["staff", "admin"]) {
    const scan = shell(role, { view: "my-batteries", scan: "return", locked: true }).render();
    assert.deepEqual(navigation(scan).filter(node => node.props.isActive).map(text), ["Scan return"]);
    const intake = shell(role, { view: "account", intake: true, locked: true }).render();
    assert.deepEqual(navigation(intake).filter(node => node.props.isActive).map(text), ["Intake & removal"]);
  }
});

test("headings describe staff read and assigned-task rights separately from administrator management", () => {
  const staffDirectories = heading("staff", "manage");
  assert.equal(text(nodes(staffDirectories).find(node => node.type === "h1")), "Directories");
  assert.match(text(staffDirectories), /read-only for staff/);
  assert.doesNotMatch(text(staffDirectories), /ADMINISTRATION/);
  const adminDirectories = heading("admin", "manage");
  assert.equal(text(nodes(adminDirectories).find(node => node.type === "h1")), "Manage records");
  assert.match(text(adminDirectories), /ADMINISTRATION/);
  assert.match(text(adminDirectories), /Manage saved battery, building and room records/);
  assert.match(text(heading("staff", "task-plans")), /complete tasks currently assigned to you/);
  assert.doesNotMatch(text(heading("staff", "task-plans")), /Configure|Prepare task/);
  assert.match(text(heading("admin", "task-plans")), /Configure shared schedules and assignments/);
  assert.match(text(heading("staff", "account")), /MY WORK/);
});

test("header scan shortcuts appear only in relevant inventory views and retain readiness and workflow guards", () => {
  const calls = [];
  for (const role of ["staff", "admin"]) {
    for (const view of ["inventory", "my-batteries", "my-loans", "my-activity", "teaching-groups"]) {
      const tree = heading(role, view, { onScan: kind => calls.push(kind) });
      for (const kind of ["return", "checkout"]) {
        const control = button(tree, `Scan ${kind}`);
        assert.ok(control, `${role} can start ${kind} from ${view}`);
        assert.equal(control.props.disabled, false);
        control.props.onClick();
        assert.equal(calls.at(-1), kind);
        assert.equal(button(heading(role, view, { ready: false }), `Scan ${kind}`).props.disabled, true);
      }
    }
    for (const view of ["account", "accounts", "manage", "task-plans", "messages", "activity", "assets"]) {
      assert.equal(button(heading(role, view), "Scan checkout"), undefined, `${view} has no unrelated checkout shortcut`);
      assert.equal(button(heading(role, view), "Scan return"), undefined, `${view} has no unrelated return shortcut`);
    }
    for (const state of [{ scan: "checkout" }, { scan: "return" }, { intake: true }]) {
      const tree = heading(role, "inventory", state);
      assert.equal(button(tree, "Scan checkout"), undefined);
      assert.equal(button(tree, "Scan return"), undefined);
    }
  }
});

test("desktop sidebar has one discoverable fixed-header toggle in expanded and icon states while mobile keeps its topbar menu", () => {
  const desktop = shell("staff");
  let tree = desktop.render();
  const toggle = () => nodes(tree).find(node => node.type === "Button" && node.props.className === "sidebar-desktop-toggle");
  assert.equal(nodes(tree).filter(node => node.type === "SidebarTrigger").length, 0, "The desktop topbar must not duplicate the sidebar control.");
  assert.ok(nodes(nodes(tree).find(node => node.type === "SidebarHeader")).includes(toggle()));
  assert.equal(toggle().props["aria-label"], "Collapse navigation");
  assert.equal(toggle().props["aria-expanded"], true);
  assert.equal(toggle().props["aria-controls"], "workspace-navigation");
  assert.match(toggle().props.title, /Ctrl\+B/);
  assert.ok(nodes(toggle()).some(node => node.type === "ChevronLeft"));
  toggle().props.onClick();
  tree = desktop.render();
  assert.equal(toggle().props["aria-label"], "Expand navigation");
  assert.equal(toggle().props["aria-expanded"], false);
  assert.deepEqual(desktop.events, [["sidebar", false]]);
  toggle().props.onClick();
  tree = desktop.render();
  assert.equal(toggle().props["aria-expanded"], true);
  assert.deepEqual(desktop.events, [["sidebar", false], ["sidebar", true]]);
  const mobile = shell("staff", {}, true).render();
  assert.equal(nodes(mobile).filter(node => node.type === "Button" && node.props.className === "sidebar-desktop-toggle").length, 0);
  assert.equal(nodes(mobile).filter(node => node.type === "SidebarTrigger").length, 1);
  assert.ok(nodes(nodes(mobile).find(node => node.type === "header")).some(node => node.type === "SidebarTrigger"));
});

test("collapsed navigation retains one native current marker and separate inventory-notice and Messages counts", () => {
  const view = shell("admin", { inventoryNotice: true, inventoryNoticeCount: 3, unreadCount: 7 }, false, true);
  let tree = view.render();
  const current = () => navigation(tree).filter(node => node.props["aria-current"] === "page");
  assert.deepEqual(current().map(text), ["Battery inventory"]);
  const inventory = nav(tree, "Battery inventory");
  assert.equal(inventory.props.tooltip, "Battery inventory · 3 unread battery registration notices");
  assert.equal(inventory.props["aria-label"], inventory.props.tooltip);
  assert.equal(nodes(inventory).find(node => node.props.className === "sidebar-inventory-notice").props["data-notice"], true);
  const messages = navigation(tree).find(node => node.props["aria-label"] === "Messages · 7 unread messages");
  assert.ok(messages);
  assert.match(messages.props.tooltip, /7 unread/);
  assert.equal(nodes(tree).filter(node => node.props.className === "sidebar-current-marker").length, 1);
  view.props.view = "messages";
  tree = view.render();
  assert.equal(current().length, 1);
  assert.equal(current()[0].props["aria-label"], "Messages · 7 unread messages");
  view.props.inventoryNoticeCount = 0;
  tree = view.render();
  assert.equal(nav(tree, "Battery inventory").props["aria-label"], "Battery inventory");
  assert.equal(nodes(nav(tree, "Battery inventory")).find(node => node.props.className === "sidebar-inventory-notice").props["data-notice"], false);
});
