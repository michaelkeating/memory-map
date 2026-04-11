import { ulid } from "ulid";
import type Database from "better-sqlite3";

export type EventType =
  | "ingest"
  | "page_create"
  | "page_update"
  | "page_delete"
  | "source_delete"
  | "source_block"
  | "lint"
  | "chat_query";

export interface EventLogRow {
  id: string;
  type: EventType;
  pageId: string | null;
  sourceId: string | null;
  text: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

export class EventLogStore {
  constructor(private db: Database.Database) {}

  log(input: {
    type: EventType;
    pageId?: string;
    sourceId?: string;
    text?: string;
    meta?: Record<string, unknown>;
  }): EventLogRow {
    const id = ulid();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO event_log (id, type, page_id, source_id, text, meta, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.type,
        input.pageId ?? null,
        input.sourceId ?? null,
        input.text ?? null,
        input.meta ? JSON.stringify(input.meta) : null,
        now
      );
    return {
      id,
      type: input.type,
      pageId: input.pageId ?? null,
      sourceId: input.sourceId ?? null,
      text: input.text ?? null,
      meta: input.meta ?? null,
      createdAt: now,
    };
  }

  /** Read recent events with optional filters */
  list(opts: {
    limit?: number;
    offset?: number;
    types?: EventType[];
  } = {}): EventLogRow[] {
    const limit = opts.limit ?? 100;
    const offset = opts.offset ?? 0;

    let where = "";
    const params: any[] = [];
    if (opts.types && opts.types.length > 0) {
      where = `WHERE type IN (${opts.types.map(() => "?").join(",")})`;
      params.push(...opts.types);
    }
    params.push(limit, offset);

    const rows = this.db
      .prepare(
        `SELECT id, type, page_id, source_id, text, meta, created_at
         FROM event_log
         ${where}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params) as any[];

    return rows.map(rowToEvent);
  }

  /** Delete a single log entry (used for redaction) */
  delete(id: string): boolean {
    const r = this.db.prepare("DELETE FROM event_log WHERE id = ?").run(id);
    return r.changes > 0;
  }

  /** Wipe all chat_query entries (privacy sweep) */
  clearChatQueries(): number {
    const r = this.db.prepare("DELETE FROM event_log WHERE type = 'chat_query'").run();
    return r.changes;
  }
}

function rowToEvent(row: any): EventLogRow {
  return {
    id: row.id,
    type: row.type,
    pageId: row.page_id,
    sourceId: row.source_id,
    text: row.text,
    meta: row.meta ? JSON.parse(row.meta) : null,
    createdAt: row.created_at,
  };
}
