import type { Dataset } from "./domain";
import { InventorySession, type Actor } from "./server/inventory/actor";
import { InventoryDatabase } from "./server/inventory/database";
import { InventoryDirectories } from "./server/inventory/directories";
import { InventoryGroups } from "./server/inventory/groups";
import { InventoryImports } from "./server/inventory/imports";
import { InventoryLifecycle } from "./server/inventory/lifecycle";
import { InventoryMaintenance } from "./server/inventory/maintenance";
import { InventoryMovements } from "./server/inventory/movements";
import { InventoryQueries } from "./server/inventory/queries";
import { InventoryRegistration } from "./server/inventory/registration";
import { InventoryTransactions } from "./server/inventory/transactions";

export type { Actor } from "./server/inventory/actor";

/** Stable application entry point for independently composed inventory services. */
export class InventoryStore {
  private readonly session: InventorySession;
  private readonly queries: InventoryQueries;
  private readonly directories: InventoryDirectories;
  private readonly registration: InventoryRegistration;
  private readonly movements: InventoryMovements;
  private readonly lifecycleOperations: InventoryLifecycle;
  private readonly maintenance: InventoryMaintenance;
  private readonly imports: InventoryImports;

  constructor(
    db: D1Database,
    readonly scope: string,
    readonly dataset: Dataset,
    actor: Actor,
    clock: () => Date = () => new Date(),
  ) {
    const database = new InventoryDatabase(db, scope);
    this.session = new InventorySession(dataset, actor, clock);
    const transactions = new InventoryTransactions(database, this.session);
    const groups = new InventoryGroups(database, this.session);
    this.queries = new InventoryQueries(database, this.session);
    this.directories = new InventoryDirectories(
      database,
      this.session,
      transactions,
    );
    this.registration = new InventoryRegistration(
      database,
      this.session,
      transactions,
      groups,
    );
    this.movements = new InventoryMovements(
      database,
      this.session,
      transactions,
      groups,
    );
    this.lifecycleOperations = new InventoryLifecycle(
      database,
      this.session,
      transactions,
      groups,
    );
    this.maintenance = new InventoryMaintenance(
      database,
      this.session,
      transactions,
      groups,
    );
    this.imports = new InventoryImports(database, this.session, transactions);
  }

  get viewerAccountId() {
    return this.session.actor.id;
  }

  snapshot() {
    return this.queries.snapshot();
  }
  exportData() {
    return this.queries.exportData();
  }
  fullActivity(activityScope: "all" | "mine" = "all") {
    return this.queries.fullActivity(activityScope);
  }
  detail(id: string) {
    return this.queries.detail(id);
  }
  scanLookup(input: unknown) {
    return this.queries.scanLookup(input);
  }

  initializeDemo() {
    return this.registration.initializeDemo();
  }
  saveBattery(input: unknown, update = false) {
    return this.registration.saveBattery(input, update);
  }
  savePerson(input: unknown, update = false) {
    return this.directories.savePerson(input, update);
  }
  saveBuilding(input: unknown, update = false) {
    return this.directories.saveBuilding(input, update);
  }
  saveRoom(input: unknown, update = false) {
    return this.directories.saveRoom(input, update);
  }

  movement(input: unknown) {
    return this.movements.movement(input);
  }
  lifecycle(input: unknown) {
    return this.lifecycleOperations.lifecycle(input);
  }
  charge(input: unknown) {
    return this.maintenance.charge(input);
  }
  observation(input: unknown) {
    return this.maintenance.observation(input);
  }
  correctLoan(input: unknown) {
    return this.maintenance.correctLoan(input);
  }
  groupMaintenance(input: unknown) {
    return this.maintenance.groupMaintenance(input);
  }
  importRecords(kind: string, records: unknown[]) {
    return this.imports.importRecords(kind, records);
  }
}
