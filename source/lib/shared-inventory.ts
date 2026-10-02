import { DomainError, type Dataset } from "./domain";

export async function sharedInventoryScope(db: D1Database, dataset: Dataset) {
    const existing = await db.prepare("SELECT scope FROM shared_inventories WHERE dataset=?").bind(dataset).first<string>("scope");
    if (existing) return existing;
    // Adopt a single legacy register without rewriting keys or history. Multiple
    // registers need collision review rather than an arbitrary winner or merge.
    const candidates = (await db.prepare("SELECT DISTINCT scope FROM (SELECT scope FROM batteries UNION SELECT scope FROM people UNION SELECT scope FROM rooms UNION SELECT scope FROM buildings) WHERE scope LIKE ? ORDER BY scope").bind(`%:${dataset}`).all<{ scope: string }>()).results;
    if (candidates.length > 1) throw new DomainError(409, "Multiple legacy inventories need a reviewed migration before shared access can begin. No records have been changed.", "legacy_inventory_review");
    const scope = candidates[0]?.scope ?? `shared:${dataset}`;
    await db.prepare("INSERT INTO shared_inventories(dataset,scope) SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM shared_inventories WHERE dataset=?)").bind(dataset, scope, dataset).run();
    return (await db.prepare("SELECT scope FROM shared_inventories WHERE dataset=?").bind(dataset).first<string>("scope"))!;
}
