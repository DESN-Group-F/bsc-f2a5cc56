import type { StaffUser } from "../../accounts";
import type { Dataset } from "../../domain";
import { IntakeStore } from "../../intake-store";

/** Manual entry may register in either shared inventory without enabling any reader ingestion. */
export class OperatorRegistrationStore extends IntakeStore<"operator_registration"> {
  constructor(db: D1Database, scope: string, dataset: Dataset, actor: Pick<StaffUser, "id" | "displayName" | "role" | "authVersion">, clock: () => Date = () => new Date()) {
    super(db, scope, dataset, actor, clock, "operator_registration");
  }
}
