import { defaultInventoryFilter, type InventoryFilter } from "../inventory-query";

/**
 * Built-in starting points for the batteries workspace. A view only sets criteria of the shared
 * query model, so counts, ordering and exports mean the same here as in the full application.
 */
export type ConsoleViewId = "active" | "in-store" | "in-use" | "attention" | "uninspected" | "mine" | "arrivals" | "retired" | "everything";
export type ConsoleView = { id: ConsoleViewId; label: string; description: string; filter: () => InventoryFilter };

const base = (changes: Partial<InventoryFilter>): (() => InventoryFilter) => () => ({ ...defaultInventoryFilter(), ...changes });

export const consoleViews: ConsoleView[] = [
  { id: "active", label: "All active", description: "Every battery in service", filter: base({}) },
  { id: "in-store", label: "In store", description: "Active batteries without a recorded loan", filter: base({ status: "in" }) },
  { id: "in-use", label: "In use", description: "Active batteries with a recorded checkout", filter: base({ status: "out" }) },
  { id: "attention", label: "Inspection concern", description: "The latest valid inspection recorded a concern", filter: base({ inspection: "concern" }) },
  { id: "uninspected", label: "No inspection recorded", description: "No valid inspection record yet", filter: base({ inspection: "none" }) },
  { id: "mine", label: "My batteries", description: "Batteries you are responsible for", filter: base({ personalScope: "responsible" }) },
  { id: "arrivals", label: "New arrivals", description: "Registered in the last 48 hours", filter: base({ newArrivalsOnly: true, sortBy: "registered", sortDirection: "desc" }) },
  { id: "retired", label: "Scrapped", description: "Scrapped batteries kept as history", filter: base({ lifecycle: "scrapped" }) },
  { id: "everything", label: "All records", description: "Active and retired batteries", filter: base({ lifecycle: "all" }) },
];

export const viewById = new Map(consoleViews.map((view) => [view.id, view]));

/** Criteria that differ from a view's own starting point, for the Applied filters row. */
export function appliedCriteria(filter: InventoryFilter, view: ConsoleView): (keyof InventoryFilter)[] {
  const start = view.filter();
  return (Object.keys(filter) as (keyof InventoryFilter)[]).filter((key) => key !== "sortBy" && key !== "sortDirection" && JSON.stringify(filter[key]) !== JSON.stringify(start[key]));
}
