import { Plus, RotateCcw, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StaffRole } from "@/lib/accounts";
import { getRolePermissions } from "@/lib/permissions";

const pages = {
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
} as const;
export type ApplicationView = keyof typeof pages;

export function WorkspaceHeading({
  role,
  view,
  scan,
  intake,
  ready,
  onScan,
  compact = false,
  onRegister,
}: {
  role: StaffRole;
  view: ApplicationView;
  scan: "checkout" | "return" | null;
  intake: boolean;
  ready: boolean;
  onScan: (kind: "checkout" | "return") => void;
  compact?: boolean;
  onRegister?: () => void;
}) {
  const permissions = getRolePermissions(role);
  const page =
    view === "manage" && permissions.manageDirectories
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
  const showActions =
    permissions.operateLoans &&
    !scan &&
    !intake &&
    ["inventory", "my-batteries", "my-loans", "my-activity", "teaching-groups"].includes(view);
  const administrationView =
    !scan &&
    !intake &&
    ((view === "manage" && permissions.manageDirectories) ||
      (view === "accounts" && permissions.manageAccounts));
  const personalView =
    !scan &&
    !intake &&
    ["account", "messages", "my-batteries", "my-loans", "my-activity"].includes(view);
  return (
    <div className={`page-heading${compact ? " page-heading-compact" : ""}`}>
      <div>
        <p className="eyebrow">
          {administrationView
            ? "ADMINISTRATION"
            : personalView
              ? "MY WORK"
              : "INVENTORY WORKSPACE"}
        </p>
        <h1>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {compact && onRegister && <Button onClick={onRegister} disabled={!ready} aria-label="Register battery"><Plus /><span className="register-label-full">Register battery</span><span className="register-label-short">Register</span></Button>}
      {showActions && !compact && (
        <div className="heading-actions">
          <Button
            variant="outline"
            onClick={() => onScan("return")}
            disabled={!ready}
          >
            <RotateCcw />
            Scan return
          </Button>
          <Button onClick={() => onScan("checkout")} disabled={!ready}>
            <ScanLine />
            Scan checkout
          </Button>
        </div>
      )}
    </div>
  );
}
