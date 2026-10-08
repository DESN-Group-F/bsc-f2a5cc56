import type { StaffUser } from "../../accounts";
import type { Dataset } from "../../domain";
import { IntakeStore } from "../../intake-store";

/** Reuse the guarded allocator; this policy cannot be selected by client payloads. */
export class MobileRegistrationStore extends IntakeStore<"manual_registration"> {
  constructor(db: D1Database, scope: string, dataset: Dataset, actor: Pick<StaffUser, "id" | "displayName" | "role" | "authVersion">, clock: () => Date = () => new Date()) {
    super(db, scope, dataset, actor, clock, "manual_registration");
  }
}
