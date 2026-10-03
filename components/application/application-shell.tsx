"use client";

import type { ReactNode } from "react";
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
} from "lucide-react";
import type { StaffUser } from "@/lib/accounts";
import type { InventorySnapshot } from "@/lib/domain";
import { isActiveBattery } from "@/lib/battery-lifecycle";
import { signOut } from "@/lib/client-session";
import { Button } from "@/components/ui/button";
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

function NavigationButton({
  onClick,
  ...props
}: React.ComponentProps<typeof SidebarMenuButton>) {
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <SidebarMenuButton
      {...props}
      onClick={(event) => {
        if (isMobile) setOpenMobile(false);
        onClick?.(event);
      }}
    />
  );
}

type ShellProps = {
  children: ReactNode;
  user: StaffUser;
  data: InventorySnapshot | null;
  view: ApplicationView | null;
  scan: "checkout" | "return" | null;
  intake: boolean;
  locked: boolean;
  ready: boolean;
  unreadCount: number | null;
  onNavigate: (view: ApplicationView) => void;
  onTeachingGroups: () => void;
  onAssets: () => void;
  onScan: (kind: "checkout" | "return") => void;
  onError: (message: string) => void;
};

export function ApplicationShell({
  children,
  user,
  data,
  view,
  scan,
  intake,
  locked,
  ready,
  unreadCount,
  onNavigate,
  onTeachingGroups,
  onAssets,
  onScan,
  onError,
}: ShellProps) {
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
      view: "manage",
      label: "Manage records",
      icon: Settings2,
      action: () => onNavigate("manage"),
    },
    {
      view: "task-plans",
      label: "Recurring tasks",
      icon: CalendarDays,
      action: () => onNavigate("task-plans"),
    },
    {
      view: "account",
      label: "My account",
      icon: UserRound,
      action: () => onNavigate("account"),
    },
    ...(user.role === "admin"
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
      style={{ "--sidebar-width": "16rem" } as React.CSSProperties}
    >
      <a className="skip-link" href="#workspace-content">
        Skip to workspace
      </a>
      <Sidebar className="app-sidebar">
        <SidebarHeader className="brand">
          <span className="brand-mark">
            <Battery size={25} strokeWidth={1.8} />
          </span>
          <div>
            <strong>Battery</strong>
            <span>Inventory workspace</span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>WORKSPACE</SidebarGroupLabel>
            <SidebarMenu>
              {workspace.map((item) => (
                <SidebarMenuItem key={item.view}>
                  <NavigationButton
                    disabled={locked || (!!item.needsData && !ready)}
                    isActive={active === item.view}
                    onClick={item.action}
                  >
                    <item.icon />
                    <span>{item.label}</span>
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
                  isActive={view === "my-batteries"}
                  onClick={() => onNavigate("my-batteries")}
                >
                  <Battery />
                  <span className="min-w-0 flex-1">
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
                </NavigationButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <NavigationButton
                  disabled={locked}
                  className="h-auto min-h-10 items-start py-2"
                  isActive={view === "my-loans"}
                  onClick={() => onNavigate("my-loans")}
                >
                  <UserRound />
                  <span className="min-w-0 flex-1">
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
                </NavigationButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <NavigationButton
                  disabled={locked}
                  isActive={view === "my-activity"}
                  onClick={() => onNavigate("my-activity")}
                >
                  <ClipboardList />
                  <span>My activity</span>
                </NavigationButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <NavigationButton
                  disabled={locked}
                  isActive={view === "messages"}
                  onClick={() => onNavigate("messages")}
                >
                  <Mail />
                  <span className="flex flex-1 items-center justify-between gap-2">
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
                </NavigationButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="sidebar-bottom">
          <FlaskConical size={18} />
          <div>
            <strong>DESN2000</strong>
            <span>Engineering project prototype</span>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="app-main">
        <header className="topbar">
          <div className="workspace-breadcrumb">
            <SidebarTrigger />
            <span>
              Faculty of Engineering <span className="breadcrumb-slash">/</span>{" "}
              Battery management
            </span>
          </div>
          <div className="topbar-account">
            <span>{user.displayName}</span>
            <span className="role-badge">
              {user.role === "admin" ? "Administrator" : "Staff"}
            </span>
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
