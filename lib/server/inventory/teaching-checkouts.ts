import { DomainError, type Dataset } from "../../domain";
import { teachingCheckoutRequestSchema, teachingCheckoutRunSchema, teachingSpecificationsMatch, teachingSpecificationDifferences, type TeachingCheckoutRequest, type TeachingCheckoutRun, type TeachingCheckoutReceipt, type TeachingCheckoutListedRun, type TeachingBatterySnapshot, type TeachingSelectionSource } from "../../teaching-checkouts";
import { validateTeachingNfcTag } from "../../teaching-nfc";
import { rejectPurgedReplay } from "../purge-evidence";
import { InventoryDatabase, type Row } from "./database";
import { InventorySession, type Actor } from "./actor";
import { InventoryGroups } from "./groups";
import { InventoryTransactions } from "./transactions";

const kind = "teaching_checkout";
const finalCode = "teaching_checkout_rejected_final";
const conflict = "The reviewed group, batteries, tags, loans or account access changed. Nothing was saved. Review the latest records before confirming.";
const bindingSql = "SELECT b.* FROM batteries b JOIN json_each(?) j ON b.id=json_extract(j.value,'$.batteryId') AND b.version=json_extract(j.value,'$.version') AND b.tag_id IS json_extract(j.value,'$.tagId') WHERE b.scope=? AND b.lifecycle_status='active'";

/** Durable temporary group checkouts. Definitions remain private and unchanged. */
export class TeachingCheckoutStore {
  private database: InventoryDatabase;
  private session: InventorySession;
  private transactions: InventoryTransactions;
  private groups: InventoryGroups;
  constructor(db: D1Database, scope: string, dataset: Dataset, actor: Actor, clock: () => Date = () => new Date()) {
    this.database = new InventoryDatabase(db, scope);
    this.session = new InventorySession(dataset, actor, clock);
    this.transactions = new InventoryTransactions(this.database, this.session);
    this.groups = new InventoryGroups(this.database, this.session);
  }
  private async account() {
    if (this.session.actor.authVersion === undefined) throw new DomainError(401, "Sign in with an active staff account before using teaching checkouts.");
    const account = await this.database.first("SELECT * FROM staff_accounts WHERE id=? AND active=1 AND auth_version=? AND role=? AND role IN ('staff','admin')", this.session.actor.id, this.session.actor.authVersion, this.session.actor.role);
    if (!account) throw new DomainError(403, "Your staff account access changed. Sign in again.");
    this.session.actor.name = String(account.display_name);
    return account;
  }
  private async replay(requestId: string, fingerprint: string): Promise<TeachingCheckoutReceipt | null> {
    const old = await this.database.first("SELECT * FROM operations WHERE id=? AND scope=?", this.database.key(requestId), this.database.scope);
    if (!old) return null;
    const result = rejectPurgedReplay(old.result_json, finalCode);
    if (old.kind !== kind || old.fingerprint !== fingerprint) throw new DomainError(409, "This request identifier was already used for a different operation.", "idempotency_conflict");
    if (result.rejected) throw new DomainError(Number(result.status), String(result.error), finalCode);
    return { ...result, replayed: true };
  }
  private async reject(requestId: string, fingerprint: string, error: DomainError) {
    const at = this.session.clock().toISOString();
    try {
      await this.database.raw.batch([this.database.statement("INSERT INTO operations(id,scope,kind,fingerprint,result_json,created_at,guard) SELECT ?,?,?,?,?,?,EXISTS(SELECT 1 FROM staff_accounts WHERE id=? AND active=1 AND auth_version=? AND role=?)", this.database.key(requestId), this.database.scope, kind, fingerprint, JSON.stringify({ rejected: true, status: error.status, error: error.message }), at, this.session.actor.id, this.session.actor.authVersion, this.session.actor.role)]);
    } catch (reservationError) {
      const replay = await this.replay(requestId, fingerprint);
      if (replay) return replay;
      const authorized = await this.database.first("SELECT id FROM staff_accounts WHERE id=? AND active=1 AND auth_version=? AND role=?", this.session.actor.id, this.session.actor.authVersion, this.session.actor.role);
      if (!authorized) throw error;
      throw reservationError;
    }
    throw new DomainError(error.status, error.message, finalCode);
  }
  private async commit(requestId: string, fingerprint: string, receipt: TeachingCheckoutReceipt, guard: string, values: unknown[], writes: D1PreparedStatement[]) {
    const accountGuard = "EXISTS(SELECT 1 FROM staff_accounts WHERE id=? AND active=1 AND auth_version=? AND role=?)";
    try {
      await this.database.raw.batch([
        this.database.statement(`INSERT INTO operations(id,scope,kind,fingerprint,result_json,created_at,guard) SELECT ?,?,?,?,?,?,CASE WHEN (${guard}) AND (${accountGuard}) THEN 1 ELSE 0 END`, this.database.key(requestId), this.database.scope, kind, fingerprint, JSON.stringify(receipt), receipt.at, ...values, this.session.actor.id, this.session.actor.authVersion, this.session.actor.role),
        ...writes,
      ]);
      return receipt;
    } catch (error) {
      const replay = await this.replay(requestId, fingerprint);
      if (replay) return replay;
      if (/constraint|UNIQUE|CHECK|FOREIGN KEY/i.test(String(error))) throw new DomainError(409, conflict, "teaching_checkout_conflict");
      throw error;
    }
  }
  private checkSource(source: TeachingSelectionSource, tagId: string | null) {
    if (source.kind !== "selection" && tagId === null) throw new DomainError(400, "A tag selection requires the reviewed registered tag.");
    if (source.kind === "native_nfc") {
      try { validateTeachingNfcTag(source.evidence, tagId); }
      catch { throw new DomainError(400, "The registered tag must match the complete adopted native NFC evidence."); }
    }
  }
  private checkQueue(sources: TeachingSelectionSource[]) {
    if (new Set(sources.map(source => source.kind)).size > 1) throw new DomainError(400, "Use one input source per replacement queue. Switch the source explicitly before creating a separate queue.");
  }
  private async snapshots(ids: string[]) {
    const rows = await this.database.rows("SELECT b.*,p.account_id AS owner_account_id,h.id AS home_room_id,h.name AS home_room_name,h.is_placeholder AS home_room_is_placeholder,building.id AS home_building_id,l.id AS current_loan_id,l.borrower_account_id AS current_borrower_account_id FROM batteries b JOIN people p ON p.key=b.owner_key LEFT JOIN rooms h ON h.key=b.home_room_key LEFT JOIN buildings building ON building.key=COALESCE(b.home_building_key,h.building_key) LEFT JOIN loans l ON l.battery_key=b.key AND l.scope=b.scope AND l.returned_at IS NULL AND l.cancelled_at IS NULL WHERE b.scope=? AND b.id IN (SELECT value FROM json_each(?))", this.database.scope, JSON.stringify(ids));
    return rows;
  }
  private snapshot(row: Row): TeachingBatterySnapshot {
    return { batteryId: String(row.id), tagId: row.tag_id === null ? null : String(row.tag_id), version: Number(row.version), name: String(row.name), model: String(row.model), chemistry: String(row.chemistry), capacityMah: row.capacity_mah === null ? null : Number(row.capacity_mah), voltage: row.voltage === null ? null : Number(row.voltage), homeBuildingId: row.home_building_id === null ? null : String(row.home_building_id), homeRoomId: row.home_room_id === null ? null : String(row.home_room_id), homeRoomName: row.home_room_name === null ? null : String(row.home_room_name), homeRoomIsPlaceholder: row.home_room_is_placeholder === null ? null : row.home_room_is_placeholder === 1 };
  }
  private scopeGuard(personalScope: TeachingCheckoutRequest["personalScope"], bindings: unknown[], returning: boolean) {
    if (personalScope === "all") return { sql: "1", values: [] as unknown[] };
    const predicate = personalScope === "responsible" ? "EXISTS(SELECT 1 FROM people p WHERE p.key=b.owner_key AND p.scope=b.scope AND p.account_id=?)" : returning ? "EXISTS(SELECT 1 FROM loans l WHERE l.battery_key=b.key AND l.scope=b.scope AND l.returned_at IS NULL AND l.cancelled_at IS NULL AND l.borrower_account_id=?)" : "0";
    return { sql: `(SELECT COUNT(*) FROM (${bindingSql}) b WHERE ${predicate})=?`, values: [JSON.stringify(bindings), this.database.scope, ...(predicate === "0" ? [] : [this.session.actor.id]), bindings.length] };
  }
  async save(input: unknown): Promise<TeachingCheckoutReceipt> {
    const value = teachingCheckoutRequestSchema.parse(input);
    const fingerprint = JSON.stringify({ actorAccountId: this.session.actor.id, dataset: this.session.dataset, payload: value });
    const old = await this.replay(value.requestId, fingerprint);
    if (old) return old;
    try {
      const account = await this.account();
      return value.action === "checkout" ? await this.checkout(value, account, fingerprint) : await this.returnRun(value, account, fingerprint);
    } catch (error) {
      const replay = await this.replay(value.requestId, fingerprint);
      if (replay) return replay;
      if (error instanceof DomainError && error.status >= 400 && error.status < 500 && this.session.actor.authVersion !== undefined) return this.reject(value.requestId, fingerprint, error);
      throw error;
    }
  }
  private async checkout(value: Extract<TeachingCheckoutRequest, { action: "checkout" }>, account: Row, fingerprint: string) {
    const originalIds = value.mappings.map(mapping => mapping.original.batteryId), actualIds = value.mappings.map(mapping => mapping.actual.batteryId);
    if (new Set(originalIds).size !== originalIds.length || new Set(actualIds).size !== actualIds.length) throw new DomainError(400, "Choose each original slot and each actual battery exactly once.");
    this.checkQueue(value.mappings.filter(mapping => mapping.method === "manual").map(mapping => mapping.source));
    const group = (await this.groups.resolve(value.teachingGroup, originalIds, value.requestId))!;
    const bindings = [...new Map(value.mappings.flatMap(mapping => [mapping.original, mapping.actual]).map(binding => [binding.batteryId, binding])).values()];
    const rows = await this.snapshots(bindings.map(binding => binding.batteryId));
    if (rows.length !== bindings.length) throw new DomainError(404, "An original or selected battery is unavailable in this inventory.");
    for (const binding of value.mappings.flatMap(mapping => [mapping.original, mapping.actual])) {
      const row = rows.find(row => row.id === binding.batteryId)!;
      if (row.version !== binding.version || row.tag_id !== binding.tagId || row.lifecycle_status !== "active") throw new DomainError(409, conflict);
      if (value.personalScope === "responsible" && row.owner_account_id !== this.session.actor.id) throw new DomainError(403, "Every requested and actual battery must remain within your responsible-owner scope.");
    }
    if (value.personalScope === "borrowed") throw new DomainError(409, "The borrowed-by-you scope contains existing loans, so it has no batteries available for a new checkout.");
    const at = this.session.clock().toISOString();
    const mappings = value.mappings.map(mapping => {
      const originalRow = rows.find(row => row.id === mapping.original.batteryId)!, actualRow = rows.find(row => row.id === mapping.actual.batteryId)!;
      if (actualRow.current_loan_id !== null) throw new DomainError(409, "A selected actual battery is already checked out. Review another candidate.");
      if (originalRow.current_loan_id !== mapping.originalLoanId) throw new DomainError(409, "The original member's reviewed loan changed. Review the group again.");
      if (mapping.method === "original") {
        if (mapping.original.batteryId !== mapping.actual.batteryId || mapping.originalLoanId !== null || mapping.source.kind !== "selection") throw new DomainError(400, "An original selection must use that unborrowed member and its reviewed binding.");
      } else if (mapping.original.batteryId === mapping.actual.batteryId || mapping.originalLoanId === null || originalRow.current_borrower_account_id === this.session.actor.id) throw new DomainError(409, "Replace only a member currently borrowed by another person. Batteries already held by you are separate existing loans.");
      if (mapping.method !== "manual" && mapping.source.kind !== "selection") throw new DomainError(400, "Automatic recommendations are selection evidence, not hardware reads.");
      this.checkSource(mapping.source, mapping.actual.tagId);
      const original = this.snapshot(originalRow), actual = this.snapshot(actualRow), specificationMatch = teachingSpecificationsMatch(original, actual);
      if (mapping.method === "automatic" && !specificationMatch) throw new DomainError(409, "The automatic replacement must have the same known model, chemistry, capacity and voltage.");
      return { original, actual, originalLoanId: mapping.originalLoanId, method: mapping.method, source: mapping.source, loanId: crypto.randomUUID(), specificationMatch, differences: teachingSpecificationDifferences(original, actual) };
    });
    const evidence = { ...group.evidence, batteryIds: [...actualIds].sort() };
    const run: TeachingCheckoutRun = { id: value.requestId, dataset: this.session.dataset, actorAccountId: this.session.actor.id, actorName: this.session.actor.name, teachingGroup: evidence, requestedBatteryIds: originalIds, mappings, createdAt: at };
    const personId = `staff-${this.session.actor.id}`, personKey = this.database.key(personId);
    const linked = await this.database.first("SELECT key,id FROM people WHERE scope=? AND account_id=?", this.database.scope, this.session.actor.id);
    if (linked && (linked.key !== personKey || linked.id !== personId)) throw new DomainError(409, "This account's directory association requires administrator review.");
    const writes = [
      this.database.statement("INSERT INTO people(key,scope,id,name,reference,role,account_id) SELECT ?,?,?,?,'','staff',? WHERE NOT EXISTS(SELECT 1 FROM people WHERE scope=? AND account_id=?)", personKey, this.database.scope, personId, account.display_name, this.session.actor.id, this.database.scope, this.session.actor.id),
      this.database.statement("INSERT INTO audit_events(id,scope,action,battery_id,actor_id,actor_name,at,details_json) SELECT ?,?,'staff_directory_linked',NULL,?,?,?,? WHERE changes()=1", crypto.randomUUID(), this.database.scope, this.session.actor.id, this.session.actor.name, at, JSON.stringify({ personId, accountId: this.session.actor.id })),
    ];
    for (const mapping of mappings) writes.push(
      this.database.statement("INSERT INTO loans(id,scope,battery_key,borrower_key,borrower_name,borrower_account_id,checked_out_at,checkout_actor_id,checkout_actor_name) VALUES(?,?,?,?,?,?,?,?,?)", mapping.loanId, this.database.scope, this.database.key(mapping.actual.batteryId), personKey, account.display_name, this.session.actor.id, at, this.session.actor.id, account.display_name),
      this.transactions.event("checkout", mapping.actual.batteryId, { requestId: value.requestId, loanId: mapping.loanId, borrower: account.display_name, borrowerId: personId, borrowerAccountId: this.session.actor.id, borrowerKind: "staff", teachingGroup: evidence, teachingCheckout: run }, at),
    );
    writes.push(this.database.statement("INSERT INTO teaching_checkouts(key,scope,id,actor_account_id,group_id,created_at,snapshot_json) VALUES(?,?,?,?,?,?,?)", this.database.key(run.id), this.database.scope, run.id, run.actorAccountId, evidence.id, at, JSON.stringify(run)));
    const originalsJson = JSON.stringify(value.mappings.map(mapping => ({ batteryId: mapping.original.batteryId, loanId: mapping.originalLoanId })));
    const scope = this.scopeGuard(value.personalScope, bindings, false);
    return this.commit(value.requestId, fingerprint, { requestId: value.requestId, actorAccountId: this.session.actor.id, dataset: this.session.dataset, action: "checkout", run, at }, `(SELECT COUNT(*) FROM (${bindingSql}))=? AND NOT EXISTS(SELECT 1 FROM loans l JOIN json_each(?) j ON l.battery_key=? || '/' || j.value WHERE l.scope=? AND l.returned_at IS NULL AND l.cancelled_at IS NULL) AND NOT EXISTS(SELECT 1 FROM json_each(?) j LEFT JOIN loans l ON l.battery_key=? || '/' || json_extract(j.value,'$.batteryId') AND l.scope=? AND l.returned_at IS NULL AND l.cancelled_at IS NULL WHERE l.id IS NOT json_extract(j.value,'$.loanId')) AND (${group.guard}) AND (${scope.sql}) AND EXISTS(SELECT 1 FROM staff_accounts WHERE id=? AND version=? AND display_name=?)`, [JSON.stringify(bindings), this.database.scope, bindings.length, JSON.stringify(actualIds), this.database.scope, this.database.scope, originalsJson, this.database.scope, this.database.scope, ...group.values, ...scope.values, this.session.actor.id, account.version, account.display_name], writes);
  }
  private async load(runId: string) {
    const row = await this.database.first("SELECT * FROM teaching_checkouts WHERE scope=? AND id=?", this.database.scope, runId);
    if (!row) throw new DomainError(404, "This teaching checkout is unavailable in this inventory.");
    return { row, run: teachingCheckoutRunSchema.parse(JSON.parse(String(row.snapshot_json))) };
  }
  private async returnRun(value: Extract<TeachingCheckoutRequest, { action: "return" }>, account: Row, fingerprint: string) {
    const { row, run } = await this.load(value.runId);
    if (new Set(value.items.map(item => item.batteryId)).size !== value.items.length || new Set(value.items.map(item => item.loanId)).size !== value.items.length) throw new DomainError(400, "Choose each actual battery and recorded loan once.");
    this.checkQueue(value.items.map(item => item.source ?? { kind: "selection" }));
    for (const item of value.items) {
      const mapping = run.mappings.find(mapping => mapping.actual.batteryId === item.batteryId && mapping.loanId === item.loanId);
      if (!mapping || "deleted" in mapping.actual) throw new DomainError(409, "Return only an outstanding actual battery and its exact loan from this checkout.");
      this.checkSource(item.source ?? { kind: "selection" }, item.tagId);
    }
    const itemJson = JSON.stringify(value.items);
    const openSql = "SELECT l.id FROM loans l JOIN json_each(?) j ON l.id=json_extract(j.value,'$.loanId') AND l.battery_key=? || '/' || json_extract(j.value,'$.batteryId') WHERE l.scope=? AND l.returned_at IS NULL AND l.cancelled_at IS NULL";
    if ((await this.database.rows(openSql, itemJson, this.database.scope, this.database.scope)).length !== value.items.length) throw new DomainError(409, "A recorded loan changed or was already returned. No later loan will be substituted.");
    if ((await this.database.rows(bindingSql, itemJson, this.database.scope)).length !== value.items.length) throw new DomainError(409, conflict);
    const at = this.session.clock().toISOString(), evidence = { ...run.teachingGroup, operationId: value.requestId, batteryIds: value.items.map(item => item.batteryId).sort() };
    const writes: D1PreparedStatement[] = [];
    for (const item of value.items) writes.push(this.database.statement("UPDATE loans SET returned_at=?,return_actor_id=?,return_actor_name=? WHERE id=? AND scope=?", at, this.session.actor.id, this.session.actor.name, item.loanId, this.database.scope), this.transactions.event("return", item.batteryId, { requestId: value.requestId, loanId: item.loanId, borrowerAccountId: run.actorAccountId, receivedByAccountId: this.session.actor.id, teachingGroup: evidence, teachingCheckout: run, selectionSource: item.source ?? { kind: "selection" } }, at));
    const scope = this.scopeGuard(value.personalScope, value.items, true);
    return this.commit(value.requestId, fingerprint, { requestId: value.requestId, actorAccountId: this.session.actor.id, dataset: this.session.dataset, action: "return", run, returnedItems: value.items, at }, `(SELECT COUNT(*) FROM (${bindingSql}))=? AND (SELECT COUNT(*) FROM (${openSql}))=? AND EXISTS(SELECT 1 FROM teaching_checkouts WHERE key=? AND snapshot_json=?) AND (${scope.sql}) AND EXISTS(SELECT 1 FROM staff_accounts WHERE id=? AND version=? AND display_name=?)`, [itemJson, this.database.scope, value.items.length, itemJson, this.database.scope, this.database.scope, value.items.length, row.key, row.snapshot_json, ...scope.values, this.session.actor.id, account.version, account.display_name], writes);
  }
  private listStatement(runId?: string) {
    return this.database.statement(`SELECT c.*,CAST(j.key AS INTEGER) AS mapping_index,b.id AS current_id,b.version AS current_version,b.tag_id AS current_tag_id,l.id AS current_loan_id,l.returned_at,l.cancelled_at FROM teaching_checkouts c JOIN json_each(c.snapshot_json,'$.mappings') j LEFT JOIN batteries b ON b.scope=c.scope AND b.id=json_extract(j.value,'$.actual.batteryId') LEFT JOIN loans l ON l.scope=c.scope AND l.id=json_extract(j.value,'$.loanId') AND l.battery_key=b.key WHERE c.scope=?${runId ? " AND c.id=?" : " AND c.actor_account_id=?"} ORDER BY c.created_at DESC,c.id,CAST(j.key AS INTEGER)`, this.database.scope, runId ?? this.session.actor.id);
  }
  private listedRows(rows: Row[]): TeachingCheckoutListedRun[] {
    const listed = new Map<string, TeachingCheckoutListedRun>();
    for (const row of rows) {
      const id = String(row.id);
      if (!listed.has(id)) listed.set(id, { ...teachingCheckoutRunSchema.parse(JSON.parse(String(row.snapshot_json))), items: [] });
      const run = listed.get(id)!, mapping = run.mappings[Number(row.mapping_index)];
      run.items.push({ batteryId: mapping.actual.batteryId, loanId: mapping.loanId, status: !row.current_id || !row.current_loan_id ? "deleted" : row.cancelled_at ? "cancelled" : row.returned_at ? "returned" : "outstanding", tagId: row.current_tag_id === null ? null : String(row.current_tag_id), version: row.current_version === null ? null : Number(row.current_version), returnedAt: row.returned_at === null ? null : String(row.returned_at) });
    }
    return [...listed.values()];
  }
  async list(runId?: string): Promise<TeachingCheckoutListedRun[]> {
    await this.account();
    // Snapshot and recorded-loan status are read by one SQLite statement. A purge
    // cannot leave stale asset snapshots paired with a newer deletion status.
    return this.listedRows((await this.listStatement(runId).all<Row>()).results);
  }
  /** Complete history for this run's actual loan IDs, excluding later loans. */
  async export(runId: string): Promise<{ run: TeachingCheckoutListedRun; loans: Row[]; events: Row[]; operator: { accountId: string; name: string } }> {
    await this.account();
    const result = await this.database.raw.batch<Row>([
      this.listStatement(runId),
      this.database.statement("SELECT l.*,b.id AS battery_id FROM teaching_checkouts c JOIN json_each(c.snapshot_json,'$.mappings') j JOIN batteries b ON b.scope=c.scope AND b.id=json_extract(j.value,'$.actual.batteryId') JOIN loans l ON l.scope=c.scope AND l.battery_key=b.key AND l.id=json_extract(j.value,'$.loanId') WHERE c.scope=? AND c.id=? ORDER BY l.checked_out_at,l.rowid", this.database.scope, runId),
      this.database.statement("SELECT e.* FROM audit_events e WHERE e.scope=? AND EXISTS(SELECT 1 FROM teaching_checkouts c JOIN json_each(c.snapshot_json,'$.mappings') j WHERE c.scope=e.scope AND c.id=? AND json_extract(e.details_json,'$.loanId')=json_extract(j.value,'$.loanId') AND e.battery_id=json_extract(j.value,'$.actual.batteryId')) ORDER BY e.at,e.rowid", this.database.scope, runId),
    ]);
    const run = this.listedRows(result[0].results)[0];
    if (!run) throw new DomainError(404, "This teaching checkout is unavailable in this inventory.");
    return { run, loans: result[1].results, events: result[2].results, operator: { accountId: this.session.actor.id, name: this.session.actor.name } };
  }
}
