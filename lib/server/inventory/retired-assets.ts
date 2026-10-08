import { canonicalModelJson } from "../../battery-models";
import { DomainError } from "../../domain";
import { retiredAssetPayloadSchema, type RetiredAssetPayload, type RetiredAssetReceipt } from "../../retired-asset-actions";
import { evidenceFingerprint, redactBatteryEvidence, referencesBattery } from "../purge-evidence";
import { InventoryDatabase, type Row } from "./database";
import { InventorySession } from "./actor";
import { InventoryTransactions } from "./transactions";

const catalogs = [
  { table: "operations", identity: "id", columns: ["id", "kind", "fingerprint", "result_json"] },
  { table: "audit_events", identity: "id", columns: ["id", "battery_id", "details_json"] },
  { table: "task_cycles", identity: "key", columns: ["key", "snapshot_json"] },
  { table: "intake_sessions", identity: "key", columns: ["key", "configuration_json", "context_json"] },
  { table: "teaching_group_operations", identity: "key", columns: ["key", "fingerprint", "result_json"] },
  { table: "teaching_group_events", identity: "id", columns: ["id", "before_json", "after_json"] },
  { table: "teaching_checkouts", identity: "key", columns: ["key", "snapshot_json"] },
] as const;

export class InventoryRetiredAssets {
  constructor(private database: InventoryDatabase, private session: InventorySession, private transactions: InventoryTransactions) {}

  private async authorize(kind: "recover" | "purge") {
    await this.session.requireLifecycleActor(this.database);
    if (kind === "purge" && this.session.actor.role !== "admin")
      throw new DomainError(403, "Only administrators can permanently delete scrapped battery data.");
  }

  private async reject(payload: RetiredAssetPayload, fingerprint: string, error: DomainError): Promise<RetiredAssetReceipt> {
    await this.authorize(payload.kind);
    const result = { kind: payload.kind, rejected: true, status: error.status, error: error.message };
    try {
      await this.database.raw.batch([this.database.statement(
        "INSERT INTO operations(id,scope,kind,fingerprint,result_json,created_at,guard) SELECT ?,?,'retired_asset_rejected',?,?,?,CASE WHEN EXISTS(SELECT 1 FROM staff_accounts WHERE id=? AND active=1 AND auth_version=? AND role=? AND (?='recover' OR role='admin')) THEN 1 ELSE 0 END",
        this.database.key(payload.requestId), this.database.scope, fingerprint, JSON.stringify(result), this.session.clock().toISOString(),
        this.session.actor.id, this.session.actor.authVersion, this.session.actor.role, payload.kind,
      )]);
    } catch (reservationError) {
      const receipt = await this.transactions.replay(payload.requestId, "retired_asset", fingerprint);
      if (receipt) return receipt as RetiredAssetReceipt;
      await this.authorize(payload.kind);
      throw reservationError;
    }
    throw new DomainError(error.status, error.message, "retired_asset_rejected_final");
  }

  async execute(input: unknown): Promise<RetiredAssetReceipt> {
    const payload = retiredAssetPayloadSchema.parse(input);
    await this.authorize(payload.kind);
    const fingerprint = await evidenceFingerprint(canonicalModelJson({ actorAccountId: this.session.actor.id, dataset: this.session.dataset, payload }));
    const previous = await this.transactions.replay(payload.requestId, "retired_asset", fingerprint);
    if (previous) return previous as RetiredAssetReceipt;
    try {
      const ids = payload.items.map(item => item.batteryId), keys = ids.map(id => this.database.key(id));
      const batteries = await this.database.rows("SELECT * FROM batteries WHERE scope=? AND id IN (SELECT value FROM json_each(?))", this.database.scope, JSON.stringify(ids));
      if (batteries.length !== ids.length) throw new DomainError(404, "A reviewed scrapped battery is no longer available in this inventory.");
      for (const item of payload.items) {
        const battery = batteries.find(row => row.id === item.batteryId)!;
        if (battery.lifecycle_status !== "scrapped" || battery.version !== item.version || battery.tag_id !== item.tagId)
          throw new DomainError(409, "A selected battery is no longer the reviewed scrapped record. Review its current status, version and tag.");
      }
      const at = this.session.clock().toISOString();
      const result: RetiredAssetReceipt = { requestId: payload.requestId, dataset: this.session.dataset, actorAccountId: this.session.actor.id, kind: payload.kind, at, replayed: false,
        items: payload.items.map(item => ({ batteryId: item.batteryId, version: item.version + 1, status: payload.kind === "recover" ? "active" : "deleted" })) };
      let guard = "(SELECT COUNT(*) FROM batteries b JOIN json_each(?) j ON b.id=json_extract(j.value,'$.batteryId') AND b.version=json_extract(j.value,'$.version') AND b.tag_id IS json_extract(j.value,'$.tagId') WHERE b.scope=? AND b.lifecycle_status='scrapped')=? AND NOT EXISTS(SELECT 1 FROM loans WHERE scope=? AND battery_key IN (SELECT value FROM json_each(?)) AND returned_at IS NULL AND cancelled_at IS NULL)";
      const guardValues: unknown[] = [JSON.stringify(payload.items), this.database.scope, ids.length, this.database.scope, JSON.stringify(keys)];
      const writes: D1PreparedStatement[] = [this.database.statement(
        "INSERT INTO retired_asset_context(scope,request_key,actor_id,actor_auth_version,kind,at) VALUES(?,?,?,?,?,?)", this.database.scope, this.database.key(payload.requestId), this.session.actor.id, this.session.actor.authVersion, payload.kind, at,
      )];
      if (payload.kind === "recover") {
        for (const item of payload.items) {
          const before = batteries.find(row => row.id === item.batteryId)!;
          writes.push(this.database.statement("UPDATE batteries SET lifecycle_status='active',lifecycle_at=NULL,lifecycle_reason=NULL,lifecycle_destination=NULL,version=version+1 WHERE scope=? AND id=? AND lifecycle_status='scrapped' AND version=? AND tag_id IS ?", this.database.scope, item.batteryId, item.version, item.tagId));
          writes.push(this.transactions.event("battery_recovered", item.batteryId, { requestId: payload.requestId, previousScrap: { at: before.lifecycle_at, reason: before.lifecycle_reason }, reviewedBinding: item, status: "active" }, at));
        }
      } else {
        const idSet = new Set(ids), keySet = new Set(keys);
        const snapshots = (await this.database.raw.batch<Row>([...catalogs.map(catalog => this.database.statement(`SELECT ${catalog.columns.join(",")} FROM ${catalog.table} WHERE scope=? ORDER BY ${catalog.identity}`, this.database.scope)), this.database.statement("SELECT version FROM inventory_evidence_revisions WHERE scope=?", this.database.scope)])).map(read => read.results);
        // A revision advances for each structured evidence mutation. Checking
        // that snapshot revision keeps the commit guard independent of history size.
        guard += " AND COALESCE((SELECT version FROM inventory_evidence_revisions WHERE scope=?),0)=?";
        guardValues.push(this.database.scope, Number(snapshots[catalogs.length][0]?.version ?? 0));
        const sessionAssets = new Map<string, Set<string>>();
        for (const operation of snapshots[0]) {
          const receipt = JSON.parse(String(operation.result_json));
          if (typeof receipt.sessionId === "string" && typeof receipt.batteryId === "string") {
            const members = sessionAssets.get(receipt.sessionId) ?? new Set<string>();
            members.add(receipt.batteryId); sessionAssets.set(receipt.sessionId, members);
          }
        }
        for (const [index, catalog] of catalogs.entries()) {
          const rows = snapshots[index];
          for (const row of rows) {
            if (catalog.table === "audit_events" && idSet.has(String(row.battery_id))) continue;
            const changes: Record<string, string> = {};
            let referenced = false;
            for (const column of catalog.columns) {
              if (!column.endsWith("_json") || row[column] === null) continue;
              const original = JSON.parse(String(row[column])), redacted = redactBatteryEvidence(original, idSet, keySet);
              referenced ||= referencesBattery(original, idSet, keySet);
              if (JSON.stringify(redacted) !== JSON.stringify(original)) changes[column] = JSON.stringify(redacted);
            }
            if ("fingerprint" in row) {
              let originalPayload: unknown = null;
              try { originalPayload = JSON.parse(String(row.fingerprint)); } catch { /* Already hashed fingerprints have no asset payload. */ }
              referenced ||= referencesBattery(originalPayload, idSet, keySet);
              if (referenced) {
                changes.fingerprint = String(row.fingerprint).startsWith("sha256:") ? String(row.fingerprint) : await evidenceFingerprint(String(row.fingerprint));
                let redacted = JSON.parse(changes.result_json ?? String(row.result_json));
                const original = JSON.parse(String(row.result_json));
                const members = Array.isArray(original.items) ? original.items.map((item: { batteryId?: unknown }) => item.batteryId).filter((id: unknown) => typeof id === "string") : Array.isArray(original.batteryIds) ? original.batteryIds : typeof original.batteryId === "string" ? [original.batteryId] : [];
                // Single-asset and entirely deleted batch receipts must not retain
                // common lifecycle reasons, destinations or names at their root.
                if (catalog.table === "operations" && members.length && members.every((id: string) => idSet.has(id))) redacted = {};
                const affected = ids.filter(id => referencesBattery(original, new Set([id]), new Set([this.database.key(id)])) || referencesBattery(originalPayload, new Set([id]), new Set([this.database.key(id)])));
                changes.result_json = JSON.stringify({ ...redacted, purgedBatteryIds: [...new Set([...(original.purgedBatteryIds ?? []), ...affected])] });
              }
            }
            if (catalog.table === "intake_sessions") {
              const sessionId = String(row.key).slice(this.database.scope.length + 1), members = sessionAssets.get(sessionId);
              if (members?.size && [...members].every(id => idSet.has(id))) {
                changes.configuration_json = "{}";
                changes.context_json = "{}";
              }
            }
            if (Object.keys(changes).length) writes.push(this.database.statement(
              `UPDATE ${catalog.table} SET ${Object.keys(changes).map(column => `${column}=?`).join(",")} WHERE scope=? AND ${catalog.identity}=?`, ...Object.values(changes), this.database.scope, row[catalog.identity],
            ));
          }
        }
        // Create minimal ID evidence before deleting children; database triggers
        // permit cleanup only within this authenticated purge batch.
        const evidence = payload.items.map(item => this.database.statement("INSERT INTO purged_batteries(key,scope,id,actor_id,at) VALUES(?,?,?,?,?)", this.database.key(item.batteryId), this.database.scope, item.batteryId, this.session.actor.id, at));
        for (const item of payload.items) if (item.tagId !== null) evidence.push(this.database.statement("INSERT INTO purged_tag_reservations(scope,tag_hash) VALUES(?,?)", this.database.scope, await evidenceFingerprint(canonicalModelJson({ scope: this.database.scope, tagId: item.tagId }))));
        writes.splice(1, 0, ...evidence);
        writes.push(
          this.database.statement("DELETE FROM battery_inspection_voids WHERE scope=? AND inspection_id IN (SELECT id FROM battery_inspections WHERE scope=? AND battery_key IN (SELECT value FROM json_each(?)))", this.database.scope, this.database.scope, JSON.stringify(keys)),
          ...["battery_inspections", "loans", "charges", "observations", "inventory_arrivals"].map(table => this.database.statement(`DELETE FROM ${table} WHERE scope=? AND battery_key IN (SELECT value FROM json_each(?))`, this.database.scope, JSON.stringify(keys))),
          this.database.statement("DELETE FROM audit_events WHERE scope=? AND battery_id IN (SELECT value FROM json_each(?))", this.database.scope, JSON.stringify(ids)),
          this.database.statement("DELETE FROM batteries WHERE scope=? AND id IN (SELECT value FROM json_each(?))", this.database.scope, JSON.stringify(ids)),
        );
      }
      writes.push(this.database.statement("DELETE FROM retired_asset_context WHERE scope=? AND request_key=?", this.database.scope, this.database.key(payload.requestId)));
      return await this.transactions.atomic(payload.requestId, "retired_asset", fingerprint, result, at, guard, guardValues, writes,
        "A reviewed battery, staff account or associated history changed. No batteries were recovered or deleted. Refresh and review the current records.", "retired_asset_conflict") as RetiredAssetReceipt;
    } catch (error) {
      const committed = await this.transactions.replay(payload.requestId, "retired_asset", fingerprint);
      if (committed) return committed as RetiredAssetReceipt;
      if (error instanceof DomainError && [400, 404, 409, 422].includes(error.status) && !["idempotency_conflict", "retired_asset_rejected_final"].includes(error.code ?? "")) return this.reject(payload, fingerprint, error);
      throw error;
    }
  }
}
