import { recordKey } from "../../domain";

export type Row = Record<string, unknown>;

/** Prepared queries for one shared inventory, with the original D1 batch boundary. */
export class InventoryDatabase {
  constructor(
    readonly raw: D1Database,
    readonly scope: string,
  ) {}

  key(id: string) {
    return recordKey(this.scope, id);
  }

  statement(sql: string, ...values: unknown[]) {
    return this.raw.prepare(sql).bind(...values);
  }

  async rows(sql: string, ...values: unknown[]): Promise<Row[]> {
    return (await this.statement(sql, ...values).all<Row>()).results;
  }

  async first(sql: string, ...values: unknown[]) {
    return this.statement(sql, ...values).first<Row>();
  }
}
