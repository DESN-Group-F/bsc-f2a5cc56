import { DomainError, uniqueIds } from "../../domain";
import {
  teachingGroupReferenceSchema,
  type TeachingGroupReference,
  type TeachingGroupEvidence,
} from "../../teaching-context";
import { InventoryDatabase } from "./database";
import { InventorySession } from "./actor";

export type ResolvedGroup = {
  evidence: TeachingGroupEvidence;
  guard: string;
  values: unknown[];
};

/** Resolve private group definitions into guarded shared-operation evidence. */
export class InventoryGroups {
  constructor(
    private database: InventoryDatabase,
    private session: InventorySession,
  ) {}

  async resolve(
    reference: TeachingGroupReference | undefined,
    ids: string[],
    operationId: string,
  ): Promise<ResolvedGroup | undefined> {
    if (!reference) return;
    const ref = teachingGroupReferenceSchema.parse(reference);
    if (this.session.actor.authVersion === undefined)
      throw new DomainError(403, "Sign in before using your teaching groups.");
    const row = await this.database.first(
      "SELECT * FROM teaching_groups WHERE scope=? AND owner_account_id=? AND id=? AND state='active' AND version=?",
      this.database.scope,
      this.session.actor.id,
      ref.id,
      ref.version,
    );
    if (!row)
      throw new DomainError(
        409,
        "This teaching group changed or is unavailable. Reopen the group and review its current members.",
        "group_conflict",
      );
    const members = JSON.parse(String(row.member_ids_json)) as string[];
    if (ids.some((id) => !members.includes(id)))
      throw new DomainError(
        409,
        "Every selected battery must belong to the reviewed teaching group. No operation was saved.",
        "group_conflict",
      );
    return {
      evidence: {
        ...ref,
        name: String(row.name),
        ownerAccountId: this.session.actor.id,
        operationId,
        batteryIds: uniqueIds(ids),
      },
      guard:
        "EXISTS(SELECT 1 FROM teaching_groups WHERE scope=? AND owner_account_id=? AND id=? AND version=? AND state='active')",
      values: [this.database.scope, this.session.actor.id, ref.id, ref.version],
    };
  }
}
