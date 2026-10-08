"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Battery, Package, ScanLine, RotateCcw, ClipboardList, Settings2, UserRound, Users, LogOut, CalendarDays, Mail, FlaskConical, } from "lucide-react";
import { isActiveBattery } from "../../lib/battery-lifecycle.js";
import { getRolePermissions } from "../../lib/permissions.js";
import { signOut } from "../../lib/client-session.js";
import { Button } from "../ui/button.js";
import { SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarFooter, SidebarInset, SidebarTrigger, useSidebar, } from "../ui/sidebar.js";
function NavigationButton({ onClick, ...props }) {
    const { isMobile, setOpenMobile } = useSidebar();
    return (_jsx(SidebarMenuButton, { ...props, onClick: (event) => {
            if (isMobile)
                setOpenMobile(false);
            onClick?.(event);
        } }));
}
export function ApplicationShell({ children, user, data, view, scan, intake, locked, ready, unreadCount, onNavigate, onTeachingGroups, onAssets, onScan, onError, }) {
    const permissions = getRolePermissions(user.role);
    const owned = data?.batteries.filter((battery) => isActiveBattery(battery) && battery.ownerAccountId === user.id) ?? [];
    const ownedOnLoan = owned.filter((battery) => battery.loanId).length;
    const borrowed = data?.batteries.filter((battery) => isActiveBattery(battery) &&
        battery.loanId &&
        battery.borrowerAccountId === user.id) ?? [];
    const workspace = [
        {
            view: "inventory",
            label: "Battery inventory",
            icon: Package,
            action: () => onNavigate("inventory"),
        },
        {
            view: "teaching-groups",
            label: "Teaching groups",
            icon: Users,
            action: onTeachingGroups,
        },
        {
            view: "assets",
            label: "Intake & removal",
            icon: Package,
            action: onAssets,
            needsData: true,
        },
        {
            view: "checkout",
            label: "Scan checkout",
            icon: ScanLine,
            action: () => onScan("checkout"),
            needsData: true,
        },
        {
            view: "return",
            label: "Scan return",
            icon: RotateCcw,
            action: () => onScan("return"),
            needsData: true,
        },
        {
            view: "activity",
            label: "Activity history",
            icon: ClipboardList,
            action: () => onNavigate("activity"),
        },
        {
            view: "task-plans",
            label: "Recurring tasks",
            icon: CalendarDays,
            action: () => onNavigate("task-plans"),
        },
        ...(!permissions.manageDirectories
            ? [
                {
                    view: "manage",
                    label: "Directories",
                    icon: ClipboardList,
                    action: () => onNavigate("manage"),
                },
            ]
            : []),
    ];
    const administration = [
        ...(permissions.manageDirectories
            ? [
                {
                    view: "manage",
                    label: "Manage records",
                    icon: Settings2,
                    action: () => onNavigate("manage"),
                },
            ]
            : []),
        ...(permissions.manageAccounts
            ? [
                {
                    view: "accounts",
                    label: "Staff accounts",
                    icon: Users,
                    action: () => onNavigate("accounts"),
                },
            ]
            : []),
    ];
    const active = scan ?? (intake ? "assets" : view);
    return (_jsxs(SidebarProvider, { style: { "--sidebar-width": "16rem" }, children: [_jsx("a", { className: "skip-link", href: "#workspace-content", children: "Skip to workspace" }), _jsxs(Sidebar, { className: "app-sidebar", children: [_jsxs(SidebarHeader, { className: "brand", children: [_jsx("span", { className: "brand-mark", children: _jsx(Battery, { size: 25, strokeWidth: 1.8 }) }), _jsxs("div", { children: [_jsx("strong", { children: "Battery" }), _jsx("span", { children: "Inventory workspace" })] })] }), _jsxs(SidebarContent, { children: [_jsxs(SidebarGroup, { children: [_jsx(SidebarGroupLabel, { children: "WORKSPACE" }), _jsx(SidebarMenu, { children: workspace.map((item) => (_jsx(SidebarMenuItem, { children: _jsxs(NavigationButton, { disabled: locked || (!!item.needsData && !ready), isActive: active === item.view, onClick: item.action, children: [_jsx(item.icon, {}), _jsx("span", { children: item.label })] }) }, item.view))) })] }), _jsxs(SidebarGroup, { children: [_jsx(SidebarGroupLabel, { children: "MY WORK" }), _jsxs(SidebarMenu, { children: [_jsx(SidebarMenuItem, { children: _jsxs(NavigationButton, { disabled: locked, className: "h-auto min-h-10 items-start py-2", isActive: active === "my-batteries", onClick: () => onNavigate("my-batteries"), children: [_jsx(Battery, {}), _jsxs("span", { className: "min-w-0 flex-1", children: [_jsxs("span", { className: "flex items-center justify-between gap-2", children: [_jsx("span", { children: "My batteries" }), _jsx("strong", { children: data ? owned.length : "—" })] }), _jsx("span", { className: "mt-1 block text-xs opacity-70", children: data
                                                                        ? `${owned.length - ownedOnLoan} in store · ${ownedOnLoan} in use`
                                                                        : "Loading status…" })] })] }) }), _jsx(SidebarMenuItem, { children: _jsxs(NavigationButton, { disabled: locked, className: "h-auto min-h-10 items-start py-2", isActive: active === "my-loans", onClick: () => onNavigate("my-loans"), children: [_jsx(UserRound, {}), _jsxs("span", { className: "min-w-0 flex-1", children: [_jsxs("span", { className: "flex items-center justify-between gap-2", children: [_jsx("span", { children: "My batteries in use" }), _jsx("strong", { children: data ? borrowed.length : "—" })] }), _jsx("span", { className: "mt-1 block text-xs opacity-70", children: data
                                                                        ? `${borrowed.length} awaiting return`
                                                                        : "Loading status…" })] })] }) }), _jsx(SidebarMenuItem, { children: _jsxs(NavigationButton, { disabled: locked, isActive: active === "my-activity", onClick: () => onNavigate("my-activity"), children: [_jsx(ClipboardList, {}), _jsx("span", { children: "My activity" })] }) }), _jsx(SidebarMenuItem, { children: _jsxs(NavigationButton, { disabled: locked, isActive: active === "messages", onClick: () => onNavigate("messages"), children: [_jsx(Mail, {}), _jsxs("span", { className: "flex flex-1 items-center justify-between gap-2", children: [_jsx("span", { children: "Messages" }), _jsxs("span", { className: "message-notifications", children: [(unreadCount ?? 0) > 0 && (_jsx("span", { className: "unread-dot", "aria-hidden": "true" })), _jsx("strong", { "aria-label": unreadCount == null
                                                                                ? "Unread count unavailable"
                                                                                : `${unreadCount} unread messages`, children: unreadCount ?? "—" })] })] })] }) }), _jsx(SidebarMenuItem, { children: _jsxs(NavigationButton, { disabled: locked, isActive: active === "account", onClick: () => onNavigate("account"), children: [_jsx(UserRound, {}), _jsx("span", { children: "My account" })] }) })] })] }), administration.length > 0 && (_jsxs(SidebarGroup, { children: [_jsx(SidebarGroupLabel, { children: "ADMINISTRATION" }), _jsx(SidebarMenu, { children: administration.map((item) => (_jsx(SidebarMenuItem, { children: _jsxs(NavigationButton, { disabled: locked, isActive: active === item.view, onClick: item.action, children: [_jsx(item.icon, {}), _jsx("span", { children: item.label })] }) }, item.view))) })] }))] }), _jsxs(SidebarFooter, { className: "sidebar-bottom", children: [_jsx(FlaskConical, { size: 18 }), _jsxs("div", { children: [_jsx("strong", { children: "DESN2000" }), _jsx("span", { children: "Engineering project prototype" })] })] })] }), _jsxs(SidebarInset, { className: "app-main", children: [_jsxs("header", { className: "topbar", children: [_jsxs("div", { className: "workspace-breadcrumb", children: [_jsx(SidebarTrigger, {}), _jsxs("span", { children: ["Faculty of Engineering ", _jsx("span", { className: "breadcrumb-slash", children: "/" }), " ", "Battery management"] })] }), _jsxs("div", { className: "topbar-account", children: [_jsx("span", { children: user.displayName }), _jsx("span", { className: "role-badge", children: user.role === "admin" ? "Administrator" : "Staff" }), _jsxs(Button, { variant: "ghost", size: "sm", disabled: locked, onClick: () => signOut().catch((error) => onError(error.message)), children: [_jsx(LogOut, { size: 16 }), "Sign out"] })] })] }), children, _jsxs("footer", { className: "workspace-footer", children: [_jsx("span", { children: "DESN2000 \u00B7 Battery inventory prototype" }), _jsx("span", { children: "Australia / Sydney \u00B7 Refreshes every 10 seconds while idle" })] })] })] }));
}
