import { ulid } from "ulid";
import type Database from "better-sqlite3";
import type { ConnectorRecord } from "@memory-map/shared";

export class ConnectorStore {
  constructor(private db: Database.Database) {}

  /** Create a new connector record (called when a connector type is first registered) */
  create(params: {
    type: string;
    name: string;
    config: Record<string, unknown>;
  }): ConnectorRecord {
    const now = new Date().toISOString();
    const id = ulid();

    this.db
      .prepare(
        `INSERT INTO connectors (id, type, name, enabled, config, state, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, '{}', ?, ?)`
      )
      .run(id, params.type, params.name, JSON.stringify(params.config), now, now);

    return {
      id,
      type: params.type,
      name: params.name,
      enabled: false,
      config: params.config,
      state: {},
      lastSyncAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  getByType(type: string): ConnectorRecord | null {
    const row = this.db
      .prepare("SELECT * FROM connectors WHERE type = ? LIMIT 1")
      .get(type) as any;
    return row ? rowToRecord(row) : null;
  }

  getById(id: string): ConnectorRecord | null {
    const row = this.db
      .prepare("SELECT * FROM connectors WHERE id = ?")
      .get(id) as any;
    return row ? rowToRecord(row) : null;
  }

  list(): ConnectorRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM connectors ORDER BY type")
      .all() as any[];
    return rows.map(rowToRecord);
  }

  /** Ensure a connector of the given type exists; create with defaults if not */
  ensureExists(params: {
    type: string;
    name: string;
    config: Record<string, unknown>;
  }): ConnectorRecord {
    const existing = this.getByType(params.type);
    if (existing) return existing;
    return this.create(params);
  }

  setEnabled(id: string, enabled: boolean): void {
    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE connectors SET enabled = ?, updated_at = ? WHERE id = ?")
      .run(enabled ? 1 : 0, now, id);
  }

  updateConfig(id: string, config: Record<string, unknown>): void {
    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE connectors SET config = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(config), now, id);
  }

  recordSync(
    id: string,
    state: Record<string, unknown>,
    error: string | null
  ): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        "UPDATE connectors SET state = ?, last_sync_at = ?, last_error = ?, updated_at = ? WHERE id = ?"
      )
      .run(JSON.stringify(state), now, error, now, id);
  }
}

function rowToRecord(row: any): ConnectorRecord {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    enabled: Boolean(row.enabled),
    config: JSON.parse(row.config ?? "{}"),
    state: JSON.parse(row.state ?? "{}"),
    lastSyncAt: row.last_sync_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
