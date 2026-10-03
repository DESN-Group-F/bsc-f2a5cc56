import type {
  BatteryRecord,
  Person,
  Room,
  Building,
  InventorySnapshot,
} from "@/lib/domain";
import type { InventoryFilter } from "@/lib/inventory-query";
import type { TeachingGroupReference } from "@/lib/teaching-context";

export type MovementDraft = {
  kind: "checkout" | "return";
  ids: string[];
  nonce: string;
  teachingGroup?: TeachingGroupReference;
  excludedIds?: string[];
};

export type InventoryAction =
  | "initialize_demo"
  | "movement"
  | "scan_lookup"
  | "intake"
  | "lifecycle"
  | "group_maintenance"
  | "person"
  | "room"
  | "building"
  | "battery"
  | "charge"
  | "observation"
  | "correction"
  | "import";

export type WriteAction = (
  action: InventoryAction,
  payload: unknown,
  extra?: Record<string, unknown>,
) => Promise<unknown>;

export type EditorDraft = {
  kind: "battery" | "person" | "building" | "room";
  record?: BatteryRecord | Person | Room | Building;
  initialTagId?: string;
};

export type ExportDraft = {
  batteryId?: string;
  selectedIds?: string[];
  selectedOnly?: boolean;
  filter: InventoryFilter;
  page: number;
  pageSize: "10" | "25" | "50" | "100";
  matching: number;
  pageCount: number;
};

export type ImportKind = "people" | "buildings" | "rooms" | "batteries";

export type RecordActions = {
  data: InventorySnapshot;
  ready: boolean;
  onEdit: (draft: EditorDraft) => void;
  onDetail: (id: string) => void;
};

export type TaskPanelProps = {
  data: InventorySnapshot;
  onChanged?: () => void | Promise<void>;
  onDetail?: (batteryId: string) => void;
};
