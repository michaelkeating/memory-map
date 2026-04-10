import { ulid } from "ulid";
import type Database from "better-sqlite3";
import type { MemorySource, IngestionSource } from "@memory-map/shared";

export class SourceStore {
  constructor(private db: Database.Database) {}

  /**
   * Record a new source memory. If a source with the same
   * (externalSource, externalId) already exists, return that one
   * instead of creating a duplicate.
   */
  recordSource(input: IngestionSource): MemorySource {
    const existing = this.db
      .prepare(
        "SELECT * FROM memory_sources WHERE external_source = ? AND external_id = ?"
      )
      .get(input.externalSource, input.externalId) as any;
    if (existing) return rowToSource(existing);

    const now = new Date().toISOString();
    const id = ulid();

    this.db
      .prepare(
        `INSERT INTO memory_sources
          (id, external_source, external_id, content, source_label, tags, importance, captured_at, ingested_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.externalSource,
        input.externalId,
        input.content,
        input.sourceLabel,
        JSON.stringify(input.tags ?? []),
        input.importance ?? null,
        input.capturedAt,
        now
      );

    return {
      id,
      externalSource: input.externalSource,
      externalId: input.externalId,
      content: input.content,
      sourceLabel: input.sourceLabel,
      tags: input.tags ?? [],
      importance: input.importance ?? null,
      capturedAt: input.capturedAt,
      ingestedAt: now,
    };
  }

  /** Tag a page with a source memory */
  linkPageToSource(pageId: string, sourceId: string, action: "created" | "updated"): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO page_sources (page_id, source_id, action, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(pageId, sourceId, action, now);
  }

  /** Tag an association with a source memory */
  linkAssociationToSource(associationId: string, sourceId: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO association_sources (association_id, source_id, created_at)
         VALUES (?, ?, ?)`
      )
      .run(associationId, sourceId, now);
  }

  /** Get all source memories that contributed to a page */
  getPageSources(pageId: string): Array<MemorySource & { action: string }> {
    const rows = this.db
      .prepare(
        `SELECT m.*, ps.action
         FROM page_sources ps
         JOIN memory_sources m ON m.id = ps.source_id
         WHERE ps.page_id = ?
         ORDER BY m.captured_at DESC`
      )
      .all(pageId) as any[];
    return rows.map((r) => ({ ...rowToSource(r), action: r.action }));
  }

  /** Get all source memories that contributed to an association */
  getAssociationSources(associationId: string): MemorySource[] {
    const rows = this.db
      .prepare(
        `SELECT m.*
         FROM association_sources as_
         JOIN memory_sources m ON m.id = as_.source_id
         WHERE as_.association_id = ?
         ORDER BY m.captured_at DESC`
      )
      .all(associationId) as any[];
    return rows.map(rowToSource);
  }

  getById(id: string): MemorySource | null {
    const row = this.db
      .prepare("SELECT * FROM memory_sources WHERE id = ?")
      .get(id) as any;
    return row ? rowToSource(row) : null;
  }

  /** Look up a source by its upstream identifier (e.g. Screenpipe memory id) */
  getByExternal(externalSource: string, externalId: string): MemorySource | null {
    const row = this.db
      .prepare(
        "SELECT * FROM memory_sources WHERE external_source = ? AND external_id = ?"
      )
      .get(externalSource, externalId) as any;
    return row ? rowToSource(row) : null;
  }
}

function rowToSource(row: any): MemorySource {
  return {
    id: row.id,
    externalSource: row.external_source,
    externalId: row.external_id,
    content: row.content,
    sourceLabel: row.source_label,
    tags: JSON.parse(row.tags ?? "[]"),
    importance: row.importance,
    capturedAt: row.captured_at,
    ingestedAt: row.ingested_at,
  };
}
