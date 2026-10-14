import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Plus, RotateCcw, ScanLine } from "lucide-react";
import { Button } from "../ui/button.js";
import { getRolePermissions } from "../../lib/permissions.js";
const pages = {
    mapping: [
        "Mapping",
        "Explore last recorded observations. These records do not confirm where batteries are now.",
    ],
    inventory: [
        "Battery inventory",
        "View shared batteries, check out to yourself and record returns.",
    ],
    "teaching-groups": [
        "Teaching groups",
        "Manage your teaching battery groups, their members and recorded operations.",
    ],
    assets: [
        "Intake & removal",
        "Register new batteries or record retirement and permanent removal, with review before saving.",
    ],
    "my-batteries": [
        "My batteries",
        "Batteries assigned to your staff account as the responsible owner.",
    ],
    "my-loans": [
        "My batteries in use",
        "Your current checkouts, status and checkout times.",
    ],
    "my-activity": [
        "My activity",
        "Review your operations and current battery status, or check batteries in and out.",
    ],
    messages: [
        "Messages",
        "Your task reminders, read state and recorded completion.",
    ],
    "task-plans": [
        "Recurring tasks",
        "View shared schedules and complete tasks currently assigned to you.",
    ],
    activity: [
        "Activity history",
        "Trace confirmed actions, their operator and any corrections.",
    ],
    account: ["My account", "Manage your profile, preferences and password."],
    accounts: ["Staff accounts", "Manage staff access and account permissions."],
    manage: [
        "Directories",
        "View and download shared directories and battery records. Saved records are read-only for staff.",
    ],
};
export function WorkspaceHeading({ role, view, scan, intake, ready, onScan, compact = false, onRegister, }) {
    const permissions = getRolePermissions(role);
    const page = view === "manage" && permissions.manageDirectories
        ? [
            "Manage records",
            "Manage saved battery, building and room records, and view the account-linked staff directory.",
        ]
        : view === "task-plans" && permissions.manageTaskPlans
            ? [
                "Recurring tasks",
                "Configure shared schedules and assignments, manage plans and complete eligible tasks.",
            ]
            : pages[view];
    const [title, description] = intake
        ? [
            "Batch intake",
            "Scan into an editable review queue, then confirm all or selected new batteries. Numbering is automatic after confirmation.",
        ]
        : scan
            ? [
                scan === "checkout" ? "Scan checkout" : "Scan return",
                "Add batteries to the review list, then confirm checkout or return. Keep working until you choose Exit scanning.",
            ]
            : page;
    const showActions = permissions.operateLoans &&
        !scan &&
        !intake &&
        ["inventory", "my-batteries", "my-loans", "my-activity", "teaching-groups"].includes(view);
    const administrationView = !scan &&
        !intake &&
        ((view === "manage" && permissions.manageDirectories) ||
            (view === "accounts" && permissions.manageAccounts));
    const personalView = !scan &&
        !intake &&
        ["account", "messages", "my-batteries", "my-loans", "my-activity"].includes(view);
    return (_jsxs("div", { className: `page-heading${compact ? " page-heading-compact" : ""}`, children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: administrationView
                            ? "ADMINISTRATION"
                            : personalView
                                ? "MY WORK"
                                : "INVENTORY WORKSPACE" }), _jsx("h1", { children: title }), _jsx("p", { className: "page-description", children: description })] }), compact && onRegister && _jsxs(Button, { onClick: onRegister, disabled: !ready, "aria-label": "Register battery", children: [_jsx(Plus, {}), _jsx("span", { className: "register-label-full", children: "Register battery" }), _jsx("span", { className: "register-label-short", children: "Register" })] }), showActions && !compact && (_jsxs("div", { className: "heading-actions", children: [_jsxs(Button, { variant: "outline", onClick: () => onScan("return"), disabled: !ready, children: [_jsx(RotateCcw, {}), "Scan return"] }), _jsxs(Button, { onClick: () => onScan("checkout"), disabled: !ready, children: [_jsx(ScanLine, {}), "Scan checkout"] })] }))] }));
}
