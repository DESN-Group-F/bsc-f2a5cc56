"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import {
  Battery,
  Package,
  ScanLine,
  RotateCcw,
  ClipboardList,
  Settings2,
  UserRound,
  Users,
  LogOut,
  CalendarDays,
  Mail,
  FlaskConical,
  ChevronLeft,
} from "lucide-react";
import type { StaffUser } from "@/lib/accounts";
import type { InventorySnapshot } from "@/lib/domain";
import { isActiveBattery } from "@/lib/battery-lifecycle";
import { getRolePermissions } from "@/lib/permissions";
import { signOut } from "@/lib/client-session";
import { Button } from "@/components/ui/button";
import { WorkspaceMotion } from "@/components/ui/workspace-motion";
import { spring } from "@/lib/client/workspace-motion";
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarInset,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import type { ApplicationView } from "./workspace-heading";
import "../../styles/sidebar-workbench.css";

function NavigationButton({
  onClick,
  ...props
}: React.ComponentProps<typeof SidebarMenuButton>) {
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <SidebarMenuButton
      {...props}
      aria-current={props.isActive ? "page" : undefined}
      onClick={(event) => {
        if (isMobile) setOpenMobile(false);
        onClick?.(event);
      }}
    />
  );
}

function DesktopNavigationToggle() {
  const { isMobile, open, toggleSidebar } = useSidebar();
  if (isMobile) return null;
  const label = open ? "Collapse navigation" : "Expand navigation";
  return (
    <div className="sidebar-toggle-row">
      <Button
        type="button"
        variant="ghost"
        className="sidebar-desktop-toggle"
        aria-label={label}
        aria-expanded={open}
        aria-controls="workspace-navigation"
        title={`${label} (Ctrl+B)`}
        onClick={toggleSidebar}
      >
        <ChevronLeft className="sidebar-toggle-chevron" aria-hidden="true" />
        <span className="sidebar-toggle-label">{open ? "Collapse" : "Expand"}</span>
        <kbd className="sidebar-toggle-shortcut" aria-hidden="true">Ctrl+B</kbd>
      </Button>
    </div>
  );
}

function MobileNavigationToggle() {
  const { isMobile } = useSidebar();
  return isMobile ? <SidebarTrigger aria-controls="workspace-navigation" /> : null;
}

function NavigationSurface({ selection, children }: { selection: string; children: ReactNode }) {
  const { isMobile } = useSidebar();
  const content = useRef<HTMLDivElement>(null);
  const position = useRef({ value: 0, velocity: 0 });
  const height = useRef({ value: 42, velocity: 0 });
  const positioned = useRef(false);
  useLayoutEffect(() => {
    const element = content.current;
    if (!element || isMobile) return;
    let stopPosition = () => {}, stopHeight = () => {};
    const measure = () => {
      const current = element.querySelector<HTMLElement>('[data-slot="sidebar-menu-button"][aria-current="page"]');
      if (!current) { element.style.setProperty("--sidebar-current-opacity", "0"); positioned.current = false; return; }
      const bounds = element.getBoundingClientRect(), selected = current.getBoundingClientRect();
      const top = selected.top - bounds.top + element.scrollTop;
      stopPosition(); stopHeight();
      if (!positioned.current) { position.current = { value: top, velocity: 0 }; height.current = { value: selected.height, velocity: 0 }; positioned.current = true; }
      stopPosition = spring(position.current.value, top, value => element.style.setProperty("--sidebar-current-top", `${value}px`), undefined, 28, position.current);
      stopHeight = spring(height.current.value, selected.height, value => element.style.setProperty("--sidebar-current-height", `${value}px`), undefined, 28, height.current);
      element.style.setProperty("--sidebar-current-opacity", "1");
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    const current = element.querySelector<HTMLElement>('[data-slot="sidebar-menu-button"][aria-current="page"]');
    if (current) observer?.observe(current);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); stopPosition(); stopHeight(); };
  }, [selection, isMobile]);
  return (
    <SidebarContent ref={content} className="sidebar-navigation-surface" role="navigation" aria-label="Main navigation">
      <span className="sidebar-current-marker" aria-hidden="true" />
      {children}
    </SidebarContent>
  );
}

type ShellProps = {
  children: ReactNode;
  scopeControls?: ReactNode;
  user: StaffUser;
  data: InventorySnapshot | null;
  view: ApplicationView | null;
  scan: "checkout" | "return" | null;
  intake: boolean;
  locked: boolean;
  ready: boolean;
  unreadCount: number | null;
  inventoryNotice?: boolean;
  inventoryNoticeCount?: number;
  onNavigate: (view: ApplicationView) => void;
  onTeachingGroups: () => void;
  onAssets: () => void;
  onScan: (kind: "checkout" | "return") => void;
  onError: (message: string) => void;
};

export function ApplicationShell({
  children,
  scopeControls,
  user,
  data,
  view,
  scan,
  intake,
  locked,
  ready,
  unreadCount,
  inventoryNotice = false,
  inventoryNoticeCount,
  onNavigate,
  onTeachingGroups,
  onAssets,
  onScan,
  onError,
}: ShellProps) {
  const permissions = getRolePermissions(user.role);
  const hasInventoryNotice = inventoryNoticeCount === undefined ? inventoryNotice : inventoryNoticeCount > 0;
  const inventoryNoticeDescription = inventoryNoticeCount === undefined
    ? "Unread battery registration notices"
    : `${inventoryNoticeCount} unread battery registration notice${inventoryNoticeCount === 1 ? "" : "s"}`;
  const owned =
    data?.batteries.filter(
      (battery) =>
        isActiveBattery(battery) && battery.ownerAccountId === user.id,
    ) ?? [];
  const ownedOnLoan = owned.filter((battery) => battery.loanId).length;
  const borrowed =
    data?.batteries.filter(
      (battery) =>
        isActiveBattery(battery) &&
        battery.loanId &&
        battery.borrowerAccountId === user.id,
    ) ?? [];
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
  return (
    <SidebarProvider
      className="application-workbench"
      style={{ "--sidebar-width": "13rem", "--sidebar-width-icon": "4.5rem" } as React.CSSProperties}
    >
      <a className="skip-link" href="#workspace-content">
        Skip to workspace
      </a>
      <WorkspaceMotion />
      <Sidebar className="app-sidebar" collapsible="icon" id="workspace-navigation">
        <SidebarHeader className="sidebar-top">
          <div className="brand" title="Battery · Inventory workspace">
            <span className="brand-mark">
              <Battery size={25} strokeWidth={1.8} />
            </span>
            <div className="sidebar-brand-label">
              <strong>Battery</strong>
              <span>Inventory workspace</span>
            </div>
          </div>
          <DesktopNavigationToggle />
        </SidebarHeader>
        <NavigationSurface selection={`${user.role}:${active ?? "none"}`}>
          <SidebarGroup>
            <SidebarGroupLabel>WORKSPACE</SidebarGroupLabel>
            <SidebarMenu>
              {workspace.map((item) => (
                <SidebarMenuItem key={item.view}>
                  <NavigationButton
                    disabled={locked || (!!item.needsData && !ready)}
                    isActive={active === item.view}
                    aria-label={item.view === "inventory" && hasInventoryNotice ? `${item.label} · ${inventoryNoticeDescription}` : item.label}
                    tooltip={item.view === "inventory" && hasInventoryNotice ? `${item.label} · ${inventoryNoticeDescription}` : item.label}
                    data-navigation-view={item.view}
                    onClick={item.action}
                  >
                    <item.icon />
                    <span className="sidebar-nav-label">{item.label}</span>
                    {item.view === "inventory" && <span className="sidebar-inventory-notice" data-notice={hasInventoryNotice} aria-hidden="true" />}
                  </NavigationButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>MY WORK</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <NavigationButton
                  disabled={locked}
                  className="h-auto min-h-10 items-start py-2"
                  isActive={active === "my-batteries"}
                  aria-label={`My batteries · ${data ? `${owned.length} total, ${owned.length - ownedOnLoan} in store, ${ownedOnLoan} in use` : "Loading status"}`}
                  tooltip={`My batteries · ${data ? `${owned.length} total · ${owned.length - ownedOnLoan} in store · ${ownedOnLoan} in use` : "Loading status…"}`}
                  onClick={() => onNavigate("my-batteries")}
                >
                  <Battery />
                  <span className="sidebar-nav-label min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span>My batteries</span>
                      <strong>{data ? owned.length : "—"}</strong>
                    </span>
                    <span className="mt-1 block text-xs opacity-70">
                      {data
                        ? `${owned.length - ownedOnLoan} in store · ${ownedOnLoan} in use`
                        : "Loading status…"}
                    </span>
                  </span>
                  <span className="sidebar-compact-count" aria-hidden="true">{data ? owned.length > 99 ? "99+" : owned.length : "—"}</span>
                </NavigationButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <NavigationButton
                  disabled={locked}
                  className="h-auto min-h-10 items-start py-2"
                  isActive={active === "my-loans"}
                  aria-label={`My batteries in use · ${data ? `${borrowed.length} awaiting return` : "Loading status"}`}
                  tooltip={`My batteries in use · ${data ? `${borrowed.length} awaiting return` : "Loading status…"}`}
                  onClick={() => onNavigate("my-loans")}
                >
                  <UserRound />
                  <span className="sidebar-nav-label min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span>My batteries in use</span>
                      <strong>{data ? borrowed.length : "—"}</strong>
                    </span>
                    <span className="mt-1 block text-xs opacity-70">
                      {data
                        ? `${borrowed.length} awaiting return`
                        : "Loading status…"}
                    </span>
                  </span>
                  <span className="sidebar-compact-count" aria-hidden="true">{data ? borrowed.length > 99 ? "99+" : borrowed.length : "—"}</span>
                </NavigationButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <NavigationButton
                  disabled={locked}
                  isActive={active === "my-activity"}
                  aria-label="My activity"
                  tooltip="My activity"
                  onClick={() => onNavigate("my-activity")}
                >
                  <ClipboardList />
                  <span className="sidebar-nav-label">My activity</span>
                </NavigationButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <NavigationButton
                  disabled={locked}
                  isActive={active === "messages"}
                  aria-label={`Messages · ${unreadCount == null ? "Unread count unavailable" : `${unreadCount} unread messages`}`}
                  tooltip={`Messages · ${unreadCount == null ? "Unread count unavailable" : `${unreadCount} unread`}`}
                  onClick={() => onNavigate("messages")}
                >
                  <Mail />
                  <span className="sidebar-nav-label flex flex-1 items-center justify-between gap-2">
                    <span>Messages</span>
                    <span className="message-notifications">
                      {(unreadCount ?? 0) > 0 && (
                        <span className="unread-dot" aria-hidden="true" />
                      )}
                      <strong
                        aria-label={
                          unreadCount == null
                            ? "Unread count unavailable"
                            : `${unreadCount} unread messages`
                        }
                      >
                        {unreadCount ?? "—"}
                      </strong>
                    </span>
                  </span>
                  <span className="sidebar-compact-count" data-unread={(unreadCount ?? 0) > 0} aria-hidden="true">{unreadCount == null ? "—" : unreadCount > 99 ? "99+" : unreadCount}</span>
                </NavigationButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <NavigationButton
                  disabled={locked}
                  isActive={active === "account"}
                  aria-label="My account"
                  tooltip="My account"
                  onClick={() => onNavigate("account")}
                >
                  <UserRound />
                  <span className="sidebar-nav-label">My account</span>
                </NavigationButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
          {administration.length > 0 && (
            <SidebarGroup>
              <SidebarGroupLabel>ADMINISTRATION</SidebarGroupLabel>
              <SidebarMenu>
                {administration.map((item) => (
                  <SidebarMenuItem key={item.view}>
                    <NavigationButton
                      disabled={locked}
                      isActive={active === item.view}
                      aria-label={item.label}
                      tooltip={item.label}
                      onClick={item.action}
                    >
                      <item.icon />
                      <span className="sidebar-nav-label">{item.label}</span>
                    </NavigationButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          )}
        </NavigationSurface>
        <SidebarFooter className="sidebar-bottom" title="DESN2000 · Engineering project prototype">
          <FlaskConical size={18} />
          <div className="sidebar-footer-label">
            <strong>DESN2000</strong>
            <span>Engineering project prototype</span>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="app-main">
        <header className="topbar">
          <div className="workspace-navigation-toggle">
            <MobileNavigationToggle />
          </div>
          <div className="workspace-global-scope">{scopeControls}</div>
          <div className="topbar-account">
            <div className="topbar-identity">
            <span>{user.displayName}</span>
            <span className="role-badge">
              {user.role === "admin" ? "Administrator" : "Staff"}
            </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={locked}
              onClick={() => signOut().catch((error) => onError(error.message))}
            >
              <LogOut size={16} />
              Sign out
            </Button>
          </div>
        </header>
        {children}
        <footer className="workspace-footer">
          <span>DESN2000 · Battery inventory prototype</span>
          <span>
            Australia / Sydney · Refreshes every 10 seconds while idle
          </span>
        </footer>
      </SidebarInset>
    </SidebarProvider>
  );
}
