import type { StaffRole } from "../../accounts";
import { DomainError, type Dataset } from "../../domain";
import type { InventoryDatabase } from "./database";

export type Actor = {
  id: string;
  name: string;
  role: StaffRole;
  authVersion?: number;
};

/** Request-local identity and clock shared by composed inventory services. */
export class InventorySession {
  constructor(
    readonly dataset: Dataset,
    public actor: Actor,
    readonly clock: () => Date,
  ) {}

  requireAdmin() {
    if (this.actor.role !== "admin") {
      throw new DomainError(
        403,
        "Only administrators can modify saved records or maintain directories.",
      );
    }
  }

  async requireLifecycleActor(database: InventoryDatabase) {
    if (this.actor.authVersion === undefined) {
      throw new DomainError(
        401,
        "Sign in with an active staff account before removing batteries.",
      );
    }
    const account = await database.first(
      "SELECT display_name FROM staff_accounts WHERE id=? AND active=1 AND auth_version=? AND role=? AND role IN ('admin','staff')",
      this.actor.id,
      this.actor.authVersion,
      this.actor.role,
    );
    if (!account) {
      throw new DomainError(
        403,
        "Your staff account access changed. Sign in again before removing batteries.",
      );
    }
    this.actor = { ...this.actor, name: String(account.display_name) };
  }
}
