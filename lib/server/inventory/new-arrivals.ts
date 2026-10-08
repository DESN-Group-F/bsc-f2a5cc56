import { DomainError } from "../../domain";
import {
  NEW_ARRIVAL_WINDOW_MS,
  newArrivalsAcknowledgementSchema,
  type NewArrivalsAcknowledgementReceipt,
  type NewArrivalsSnapshot,
} from "../../new-arrivals";
import { InventoryDatabase, type Row } from "./database";
import { InventorySession } from "./actor";

/** Account-local reading state for first registrations in a shared inventory. */
export class InventoryNewArrivals {
  constructor(private database: InventoryDatabase, private session: InventorySession) {}

  snapshotStatements() {
    const earliest = new Date(this.session.clock().getTime() - NEW_ARRIVAL_WINDOW_MS).toISOString();
    return [
      this.database.statement(
        "SELECT COALESCE((SELECT last_sequence FROM inventory_arrival_counters WHERE scope=?),0) AS throughSequence,COALESCE((SELECT through_sequence FROM inventory_arrival_acknowledgements WHERE scope=? AND account_id=?),0) AS acknowledgedThroughSequence",
        this.database.scope, this.database.scope, this.session.actor.id,
      ),
      this.database.statement(
        "SELECT b.id AS batteryId,a.sequence,a.registered_at AS registeredAt,a.actor_account_id AS registeredByAccountId FROM inventory_arrivals a JOIN batteries b ON b.key=a.battery_key AND b.scope=a.scope WHERE a.scope=? AND b.lifecycle_status='active' AND julianday(a.registered_at)>julianday(?) ORDER BY a.sequence DESC,b.id",
        this.database.scope, earliest,
      ),
    ];
  }

  snapshotResult(metadata: Row[], records: Row[], serverNow: string): NewArrivalsSnapshot {
    const throughSequence = Number(metadata[0]?.throughSequence ?? 0);
    const acknowledgedThroughSequence = Number(metadata[0]?.acknowledgedThroughSequence ?? 0);
    const now = new Date(serverNow).getTime();
    const items = records.filter(record => {
      const age = now - new Date(String(record.registeredAt)).getTime();
      return age >= 0 && age < NEW_ARRIVAL_WINDOW_MS;
    }).map(record => ({
      batteryId: String(record.batteryId),
      sequence: Number(record.sequence),
      registeredAt: String(record.registeredAt),
      isUnread: record.registeredByAccountId !== this.session.actor.id && Number(record.sequence) > acknowledgedThroughSequence,
    }));
    return { serverNow, throughSequence, acknowledgedThroughSequence, unreadCount: items.filter(item => item.isUnread).length, items };
  }

  async acknowledge(input: unknown): Promise<NewArrivalsAcknowledgementReceipt> {
    const { throughSequence } = newArrivalsAcknowledgementSchema.parse(input);
    const actor = this.session.actor;
    if (actor.authVersion === undefined)
      throw new DomainError(401, "Sign in with an active staff account before acknowledging new arrivals.");
    const account = await this.database.first(
      "SELECT id FROM staff_accounts WHERE id=? AND active=1 AND auth_version=? AND role=? AND role IN ('staff','admin')",
      actor.id, actor.authVersion, actor.role,
    );
    if (!account)
      throw new DomainError(403, "Your staff account access changed. Sign in again before acknowledging new arrivals.");
    const guard = "EXISTS(SELECT 1 FROM staff_accounts WHERE id=? AND active=1 AND auth_version=? AND role=? AND role IN ('staff','admin')) AND ?<=COALESCE((SELECT last_sequence FROM inventory_arrival_counters WHERE scope=?),0)";
    const guardValues = [actor.id, actor.authVersion, actor.role, throughSequence, this.database.scope];
    try {
      const result = await this.database.raw.batch<Row>([
        this.database.statement(
          `INSERT INTO inventory_arrival_acknowledgements(key,scope,account_id,through_sequence) SELECT ?,?,?,CASE WHEN (${guard}) THEN ? ELSE -1 END WHERE NOT EXISTS(SELECT 1 FROM inventory_arrival_acknowledgements WHERE scope=? AND account_id=?)`,
          this.database.key(actor.id), this.database.scope, actor.id, ...guardValues, throughSequence, this.database.scope, actor.id,
        ),
        this.database.statement(
          `UPDATE inventory_arrival_acknowledgements SET through_sequence=CASE WHEN (${guard}) THEN MAX(through_sequence,?) ELSE -1 END WHERE scope=? AND account_id=?`,
          ...guardValues, throughSequence, this.database.scope, actor.id,
        ),
        this.database.statement(
          "SELECT through_sequence FROM inventory_arrival_acknowledgements WHERE scope=? AND account_id=?",
          this.database.scope, actor.id,
        ),
      ]);
      return { dataset: this.session.dataset, actorAccountId: actor.id, acknowledgedThroughSequence: Number(result[2].results[0].through_sequence) };
    } catch (error) {
      if (/constraint|CHECK|FOREIGN KEY/i.test(String(error)))
        throw new DomainError(409, "The new-arrivals cursor or staff access changed. Refresh before acknowledging these arrivals.");
      throw error;
    }
  }
}
