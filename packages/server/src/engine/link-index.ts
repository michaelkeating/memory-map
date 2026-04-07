import type Database from "better-sqlite3";
import { slugify } from "@memory-map/shared";
import { extractWikilinks } from "./wikilink-parser.js";

/**
 * In-memory bidirectional link index.
 * Tracks explicit [[wikilinks]] between pages.
 * Also syncs to the SQLite `links` table for persistence.
 */
export class LinkIndex {
  /** pageId -> set of pageIds this page links TO */
  private forwardLinks = new Map<string, Set<string>>();
  /** pageId -> set of pageIds that link TO this page */
  private backlinks = new Map<string, Set<string>>();

  constructor(private db: Database.Database) {}

  /** Rebuild the entire index from the links table */
  rebuild(): void {
    this.forwardLinks.clear();
    this.backlinks.clear();

    const rows = this.db
      .prepare("SELECT source_id, target_id FROM links")
      .all() as Array<{ source_id: string; target_id: string }>;

    for (const row of rows) {
      this.addToMemory(row.source_id, row.target_id);
    }
  }

  /** Update links for a page. Resolves wikilink titles to page IDs via the pages table. */
  updateForPage(pageId: string, wikilinkTargets: string[]): void {
    // Remove old forward links for this page
    const oldForward = this.forwardLinks.get(pageId) ?? new Set();
    for (const targetId of oldForward) {
      this.backlinks.get(targetId)?.delete(pageId);
    }
    this.forwardLinks.delete(pageId);

    // Delete from DB
    this.db.prepare("DELETE FROM links WHERE source_id = ?").run(pageId);

    // Resolve targets to IDs and insert new links
    const insertStmt = this.db.prepare(
      "INSERT OR IGNORE INTO links (source_id, target_id) VALUES (?, ?)"
    );

    for (const target of wikilinkTargets) {
      const targetSlug = slugify(target);
      const row = this.db
        .prepare("SELECT id FROM pages WHERE slug = ? OR LOWER(title) = LOWER(?)")
        .get(targetSlug, target) as { id: string } | undefined;

      if (row && row.id !== pageId) {
        insertStmt.run(pageId, row.id);
        this.addToMemory(pageId, row.id);
      }
    }
  }

  /** Get backlinks for a page */
  getBacklinks(pageId: string): string[] {
    return [...(this.backlinks.get(pageId) ?? [])];
  }

  /** Get forward links for a page */
  getForwardLinks(pageId: string): string[] {
    return [...(this.forwardLinks.get(pageId) ?? [])];
  }

  /** Get all explicit link edges (for graph visualization) */
  getAllEdges(): Array<{ source: string; target: string }> {
    const edges: Array<{ source: string; target: string }> = [];
    for (const [source, targets] of this.forwardLinks) {
      for (const target of targets) {
        edges.push({ source, target });
      }
    }
    return edges;
  }

  private addToMemory(sourceId: string, targetId: string): void {
    if (!this.forwardLinks.has(sourceId)) {
      this.forwardLinks.set(sourceId, new Set());
    }
    this.forwardLinks.get(sourceId)!.add(targetId);

    if (!this.backlinks.has(targetId)) {
      this.backlinks.set(targetId, new Set());
    }
    this.backlinks.get(targetId)!.add(sourceId);
  }
}
