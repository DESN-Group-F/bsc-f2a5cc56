import { RotateCcw, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";

const pages = {
  inventory: [
    "Battery inventory",
    "Manage battery loans, responsibility, buildings and rooms.",
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
    "Inventory operations recorded by your staff account.",
  ],
  messages: [
    "Messages",
    "Your task reminders, read state and recorded completion.",
  ],
  "task-plans": [
    "Recurring tasks",
    "Prepare task content, schedules and staff assignments from three supplied templates.",
  ],
  activity: [
    "Activity history",
    "Trace confirmed actions, their operator and any corrections.",
  ],
  account: ["My account", "Manage your profile, preferences and password."],
  accounts: ["Staff accounts", "Manage staff access and account permissions."],
  manage: [
    "Manage records",
    "Shared staff, buildings, rooms and battery records.",
  ],
} as const;
export type ApplicationView = keyof typeof pages;

export function WorkspaceHeading({
  view,
  scan,
  intake,
  ready,
  onScan,
}: {
  view: ApplicationView;
  scan: "checkout" | "return" | null;
  intake: boolean;
  ready: boolean;
  onScan: (kind: "checkout" | "return") => void;
}) {
  const [title, description] = intake
    ? [
        "Batch intake",
        "Scan into an editable review queue, then confirm all or selected new batteries. Numbering is automatic after confirmation.",
      ]
    : scan
      ? [
          scan === "checkout" ? "Scan checkout" : "Scan return",
          "Keep scanning until you choose Exit scanning. Process each battery or confirm a batch.",
        ]
      : pages[view];
  const showActions =
    !scan && !intake && !["assets", "messages", "task-plans"].includes(view);
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">INVENTORY MANAGEMENT</p>
        <h1>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {showActions && (
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
