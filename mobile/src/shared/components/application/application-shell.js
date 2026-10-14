"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useLayoutEffect, useRef } from "react";
import { Battery, Package, ScanLine, RotateCcw, ClipboardList, Settings2, UserRound, Users, LogOut, CalendarDays, Mail, FlaskConical, ChevronLeft, Map as MapIcon, } from "lucide-react";
import { isActiveBattery } from "../../lib/battery-lifecycle.js";
import { getRolePermissions } from "../../lib/permissions.js";
import { signOut } from "../../lib/client-session.js";
import { Button } from "../ui/button.js";
import { WorkspaceMotion } from "../ui/workspace-motion.js";
import { spring } from "../../lib/client/workspace-motion.js";
import { SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarFooter, SidebarInset, SidebarTrigger, useSidebar, } from "../ui/sidebar.js";
import "../../styles/sidebar-workbench.css";
function NavigationButton({ onClick, ...props }) {
    const { isMobile, setOpenMobile } = useSidebar();
    return (_jsx(SidebarMenuButton, { ...props, "aria-current": props.isActive ? "page" : undefined, onClick: (event) => {
            if (isMobile)
                setOpenMobile(false);
            onClick?.(event);
        } }));
}
function DesktopNavigationToggle() {
    const { isMobile, open, toggleSidebar } = useSidebar();
    if (isMobile)
        return null;
    const label = open ? "Collapse navigation" : "Expand navigation";
    return (_jsx("div", { className: "sidebar-toggle-row", children: _jsxs(Button, { type: "button", variant: "ghost", className: "sidebar-desktop-toggle", "aria-label": label, "aria-expanded": open, "aria-controls": "workspace-navigation", title: `${label} (Ctrl+B)`, onClick: toggleSidebar, children: [_jsx(ChevronLeft, { className: "sidebar-toggle-chevron", "aria-hidden": "true" }), _jsx("span", { className: "sidebar-toggle-label", children: open ? "Collapse" : "Expand" }), _jsx("kbd", { className: "sidebar-toggle-shortcut", "aria-hidden": "true", children: "Ctrl+B" })] }) }));
}
function MobileNavigationToggle() {
    const { isMobile } = useSidebar();
    return isMobile ? _jsx(SidebarTrigger, { "aria-controls": "workspace-navigation" }) : null;
}
function NavigationSurface({ selection, children }) {
    const { isMobile } = useSidebar();
    const content = useRef(null);
    const position = useRef({ value: 0, velocity: 0 });
    const height = useRef({ value: 42, velocity: 0 });
    const positioned = useRef(false);
    useLayoutEffect(() => {
        const element = content.current;
        if (!element || isMobile)
            return;
        let stopPosition = () => { }, stopHeight = () => { };
        const measure = () => {
            const current = element.querySelector('[data-slot="sidebar-menu-button"][aria-current="page"]');
            if (!current || current.closest(".sidebar-quick-actions")) {
                element.style.setProperty("--sidebar-current-opacity", "0");
                positioned.current = false;
                return;
            }
            const bounds = element.getBoundingClientRect(), selected = current.getBoundingClientRect();
            const top = selected.top - bounds.top + element.scrollTop;
            stopPosition();
            stopHeight();
            if (!positioned.current) {
                position.current = { value: top, velocity: 0 };
                height.current = { value: selected.height, velocity: 0 };
                positioned.current = true;
            }
            stopPosition = spring(position.current.value, top, value => element.style.setProperty("--sidebar-current-top", `${value}px`), undefined, 28, position.current);
            stopHeight = spring(height.current.value, selected.height, value => element.style.setProperty("--sidebar-current-height", `${value}px`), undefined, 28, height.current);
            element.style.setProperty("--sidebar-current-opacity", "1");
        };
        measure();
        const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
        observer?.observe(element);
        const current = element.querySelector('[data-slot="sidebar-menu-button"][aria-current="page"]');
        if (current)
            observer?.observe(current);
        window.addEventListener("resize", measure);
        return () => { observer?.disconnect(); window.removeEventListener("resize", measure); stopPosition(); stopHeight(); };
    }, [selection, isMobile]);
    return (_jsxs(SidebarContent, { ref: content, className: "sidebar-navigation-surface", role: "navigation", "aria-label": "Main navigation", children: [_jsx("span", { className: "sidebar-current-marker", "aria-hidden": "true" }), children] }));
}
export function ApplicationShell({ children, scopeControls, user, data, view, scan, intake, locked, ready, unreadCount, inventoryNotice = false, inventoryNoticeCount, onNavigate, onTeachingGroups, onAssets, onScan, onError, }) {
    const permissions = getRolePermissions(user.role);
    const hasInventoryNotice = inventoryNoticeCount === undefined ? inventoryNotice : inventoryNoticeCount > 0;
    const inventoryNoticeDescription = inventoryNoticeCount === undefined
        ? "Unread battery registration notices"
        : `${inventoryNoticeCount} unread battery registration notice${inventoryNoticeCount === 1 ? "" : "s"}`;
    const owned = data?.batteries.filter((battery) => isActiveBattery(battery) && battery.ownerAccountId === user.id) ?? [];
    const ownedOnLoan = owned.filter((battery) => battery.loanId).length;
    const borrowed = data?.batteries.filter((battery) => isActiveBattery(battery) &&
        battery.loanId &&
        battery.borrowerAccountId === user.id) ?? [];
    const quickActions = [
        { view: "checkout", label: "Scan checkout", icon: ScanLine, action: () => onScan("checkout") },
        { view: "return", label: "Scan return", icon: RotateCcw, action: () => onScan("return") },
        { view: "assets", label: "Intake & removal", icon: Package, action: onAssets },
    ];
    const workspace = [
        {
            view: "inventory",
            label: "Battery inventory",
            icon: Package,
            action: () => onNavigate("inventory"),
        },
        {
            view: "mapping",
            label: "Mapping",
            icon: MapIcon,
            action: () => onNavigate("mapping"),
        },
        {
            view: "teaching-groups",
            label: "Teaching groups",
            icon: Users,
            action: onTeachingGroups,
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
    return (_jsxs(SidebarProvider, { className: "application-workbench", style: { "--sidebar-width": "13rem", "--sidebar-width-icon": "4.5rem" }, children: [_jsx("a", { className: "skip-link", href: "#workspace-content", children: "Skip to workspace" }), _jsx(WorkspaceMotion, {}), _jsxs(Sidebar, { className: "app-sidebar", collapsible: "icon", id: "workspace-navigation", children: [_jsxs(SidebarHeader, { className: "sidebar-top", children: [_jsxs("div", { className: "brand", title: "Battery \u00B7 Inventory workspace", children: [_jsx("span", { className: "brand-mark", children: _jsx(Battery, { size: 25, strokeWidth: 1.8 }) }), _jsxs("div", { className: "sidebar-brand-label", children: [_jsx("strong", { children: "Battery" }), _jsx("span", { children: "Inventory workspace" })] })] }), _jsx(DesktopNavigationToggle, {})] }), _jsxs(NavigationSurface, { selection: `${user.role}:${active ?? "none"}`, children: [_jsxs(SidebarGroup, { className: "sidebar-quick-actions", children: [_jsx(SidebarGroupLabel, { children: "QUICK ACTIONS" }), _jsx(SidebarMenu, { className: "sidebar-quick-actions-menu", children: quickActions.map((item) => (_jsx(SidebarMenuItem, { children: _jsxs(NavigationButton, { className: "sidebar-operation", disabled: locked || !ready, isActive: active === item.view, "aria-label": item.label, tooltip: item.label, "data-navigation-view": item.view, "data-operation": item.view, onClick: item.action, children: [_jsx("span", { className: "sidebar-operation-icon", "aria-hidden": "true", children: _jsx(item.icon, {}) }), _jsx("span", { className: "sidebar-nav-label", children: item.label })] }) }, item.view))) })] }), _jsxs(SidebarGroup, { children: [_jsx(SidebarGroupLabel, { children: "WORKSPACE" }), _jsx(SidebarMenu, { children: workspace.map((item) => (_jsx(SidebarMenuItem, { children: _jsxs(NavigationButton, { disabled: locked, isActive: active === item.view, "aria-label": item.view === "inventory" && hasInventoryNotice ? `${item.label} · ${inventoryNoticeDescription}` : item.label, tooltip: item.view === "inventory" && hasInventoryNotice ? `${item.label} · ${inventoryNoticeDescription}` : item.label, "data-navigation-view": item.view, onClick: item.action, children: [_jsx(item.icon, {}), _jsx("span", { className: "sidebar-nav-label", children: item.label }), item.view === "inventory" && _jsx("span", { className: "sidebar-inventory-notice", "data-notice": hasInventoryNotice, "aria-hidden": "true" })] }) }, item.view))) })] }), _jsxs(SidebarGroup, { children: [_jsx(SidebarGroupLabel, { children: "MY WORK" }), _jsxs(SidebarMenu, { children: [_jsx(SidebarMenuItem, { children: _jsxs(NavigationButton, { disabled: locked, className: "h-auto min-h-10 items-start py-2", isActive: active === "my-batteries", "aria-label": `My batteries · ${data ? `${owned.length} total, ${owned.length - ownedOnLoan} in store, ${ownedOnLoan} in use` : "Loading status"}`, tooltip: `My batteries · ${data ? `${owned.length} total · ${owned.length - ownedOnLoan} in store · ${ownedOnLoan} in use` : "Loading status…"}`, onClick: () => onNavigate("my-batteries"), children: [_jsx(Battery, {}), _jsxs("span", { className: "sidebar-nav-label min-w-0 flex-1", children: [_jsxs("span", { className: "flex items-center justify-between gap-2", children: [_jsx("span", { children: "My batteries" }), _jsx("strong", { children: data ? owned.length : "—" })] }), _jsx("span", { className: "mt-1 block text-xs opacity-70", children: data
                                                                        ? `${owned.length - ownedOnLoan} in store · ${ownedOnLoan} in use`
                                                                        : "Loading status…" })] }), _jsx("span", { className: "sidebar-compact-count", "aria-hidden": "true", children: data ? owned.length > 99 ? "99+" : owned.length : "—" })] }) }), _jsx(SidebarMenuItem, { children: _jsxs(NavigationButton, { disabled: locked, className: "h-auto min-h-10 items-start py-2", isActive: active === "my-loans", "aria-label": `My batteries in use · ${data ? `${borrowed.length} awaiting return` : "Loading status"}`, tooltip: `My batteries in use · ${data ? `${borrowed.length} awaiting return` : "Loading status…"}`, onClick: () => onNavigate("my-loans"), children: [_jsx(UserRound, {}), _jsxs("span", { className: "sidebar-nav-label min-w-0 flex-1", children: [_jsxs("span", { className: "flex items-center justify-between gap-2", children: [_jsx("span", { children: "My batteries in use" }), _jsx("strong", { children: data ? borrowed.length : "—" })] }), _jsx("span", { className: "mt-1 block text-xs opacity-70", children: data
                                                                        ? `${borrowed.length} awaiting return`
                                                                        : "Loading status…" })] }), _jsx("span", { className: "sidebar-compact-count", "aria-hidden": "true", children: data ? borrowed.length > 99 ? "99+" : borrowed.length : "—" })] }) }), _jsx(SidebarMenuItem, { children: _jsxs(NavigationButton, { disabled: locked, isActive: active === "my-activity", "aria-label": "My activity", tooltip: "My activity", onClick: () => onNavigate("my-activity"), children: [_jsx(ClipboardList, {}), _jsx("span", { className: "sidebar-nav-label", children: "My activity" })] }) }), _jsx(SidebarMenuItem, { children: _jsxs(NavigationButton, { disabled: locked, isActive: active === "messages", "aria-label": `Messages · ${unreadCount == null ? "Unread count unavailable" : `${unreadCount} unread messages`}`, tooltip: `Messages · ${unreadCount == null ? "Unread count unavailable" : `${unreadCount} unread`}`, onClick: () => onNavigate("messages"), children: [_jsx(Mail, {}), _jsxs("span", { className: "sidebar-nav-label flex flex-1 items-center justify-between gap-2", children: [_jsx("span", { children: "Messages" }), _jsxs("span", { className: "message-notifications", children: [(unreadCount ?? 0) > 0 && (_jsx("span", { className: "unread-dot", "aria-hidden": "true" })), _jsx("strong", { "aria-label": unreadCount == null
                                                                                ? "Unread count unavailable"
                                                                                : `${unreadCount} unread messages`, children: unreadCount ?? "—" })] })] }), _jsx("span", { className: "sidebar-compact-count", "data-unread": (unreadCount ?? 0) > 0, "aria-hidden": "true", children: unreadCount == null ? "—" : unreadCount > 99 ? "99+" : unreadCount })] }) }), _jsx(SidebarMenuItem, { children: _jsxs(NavigationButton, { disabled: locked, isActive: active === "account", "aria-label": "My account", tooltip: "My account", onClick: () => onNavigate("account"), children: [_jsx(UserRound, {}), _jsx("span", { className: "sidebar-nav-label", children: "My account" })] }) })] })] }), administration.length > 0 && (_jsxs(SidebarGroup, { children: [_jsx(SidebarGroupLabel, { children: "ADMINISTRATION" }), _jsx(SidebarMenu, { children: administration.map((item) => (_jsx(SidebarMenuItem, { children: _jsxs(NavigationButton, { disabled: locked, isActive: active === item.view, "aria-label": item.label, tooltip: item.label, onClick: item.action, children: [_jsx(item.icon, {}), _jsx("span", { className: "sidebar-nav-label", children: item.label })] }) }, item.view))) })] }))] }), _jsxs(SidebarFooter, { className: "sidebar-bottom", title: "DESN2000 \u00B7 Engineering project prototype", children: [_jsx(FlaskConical, { size: 18 }), _jsxs("div", { className: "sidebar-footer-label", children: [_jsx("strong", { children: "DESN2000" }), _jsx("span", { children: "Engineering project prototype" })] })] })] }), _jsxs(SidebarInset, { className: "app-main", children: [_jsxs("header", { className: "topbar", children: [_jsx("div", { className: "workspace-navigation-toggle", children: _jsx(MobileNavigationToggle, {}) }), _jsx("div", { className: "workspace-global-scope", children: scopeControls }), _jsxs("div", { className: "topbar-account", children: [_jsxs("div", { className: "topbar-identity", children: [_jsx("span", { children: user.displayName }), _jsx("span", { className: "role-badge", children: user.role === "admin" ? "Administrator" : "Staff" })] }), _jsxs(Button, { variant: "ghost", size: "sm", disabled: locked, onClick: () => signOut().catch((error) => onError(error.message)), children: [_jsx(LogOut, { size: 16 }), "Sign out"] })] })] }), children, _jsxs("footer", { className: "workspace-footer", children: [_jsx("span", { children: "DESN2000 \u00B7 Battery inventory prototype" }), _jsx("span", { children: "Australia / Sydney \u00B7 Refreshes every 10 seconds while idle" })] })] })] }));
}
