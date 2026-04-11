import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { ulid } from "ulid";
import type Database from "better-sqlite3";
import {
  type Page,
  type PageFrontmatter,
  type CreatePageOp,
  type UpdatePageOp,
  slugify,
} from "@memory-map/shared";
import { getPagesDir } from "../config.js";
import { extractWikilinks } from "../engine/wikilink-parser.js";

export class PageStore {
  constructor(private db: Database.Database) {}

  /** Create a new page from an LLM operation. Returns the created page. */
  create(op: CreatePageOp, source: "chat" | "connector" | "manual" = "chat"): Page {
    const now = new Date().toISOString();
    const id = ulid();
    let slug = slugify(op.title);

    // Handle slug collision
    const existing = this.db
      .prepare("SELECT id FROM pages WHERE slug = ?")
      .get(slug) as { id: string } | undefined;
    if (existing) {
      slug = `${slug}-${id.slice(-6).toLowerCase()}`;
    }

    const frontmatter: PageFrontmatter = {
      id,
      title: op.title,
      created: now,
      modified: now,
      tags: op.tags ?? [],
      aliases: op.aliases ?? [],
      source,
    };

    const links = extractWikilinks(op.content);

    // Write .md file
    const fileContent = matter.stringify(op.content, frontmatter);
    const filePath = path.join(getPagesDir(), `${slug}.md`);
    fs.writeFileSync(filePath, fileContent, "utf-8");

    // Index in SQLite
    this.db
      .prepare(
        `INSERT INTO pages (id, slug, title, tags, aliases, source, created_at, modified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        slug,
        op.title,
        JSON.stringify(frontmatter.tags),
        JSON.stringify(frontmatter.aliases),
        source,
        now,
        now
      );

    // Index in FTS
    this.db
      .prepare(
        `INSERT INTO pages_fts (rowid, title, content, tags)
         VALUES ((SELECT rowid FROM pages WHERE id = ?), ?, ?, ?)`
      )
      .run(id, op.title, op.content, frontmatter.tags.join(" "));

    const page: Page = {
      frontmatter,
      content: op.content,
      slug,
      links,
      backlinks: [],
    };

    return page;
  }

  /** Update an existing page by slug */
  update(op: UpdatePageOp): Page | null {
    const row = this.db
      .prepare("SELECT id, slug FROM pages WHERE slug = ?")
      .get(op.slug) as { id: string; slug: string } | undefined;
    if (!row) return null;

    const filePath = path.join(getPagesDir(), `${row.slug}.md`);
    if (!fs.existsSync(filePath)) return null;

    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = matter(raw);
    const fm = parsed.data as PageFrontmatter;

    let newContent: string;
    if (op.replaceContent != null) {
      newContent = op.replaceContent;
    } else if (op.append) {
      newContent = parsed.content.trimEnd() + "\n\n" + op.append;
    } else {
      return null;
    }

    const now = new Date().toISOString();
    fm.modified = now;

    const fileContent = matter.stringify(newContent, fm);
    fs.writeFileSync(filePath, fileContent, "utf-8");

    // Update SQLite index
    this.db
      .prepare("UPDATE pages SET modified_at = ? WHERE id = ?")
      .run(now, row.id);

    // Update FTS
    this.db
      .prepare(
        `UPDATE pages_fts SET content = ? WHERE rowid = (SELECT rowid FROM pages WHERE id = ?)`
      )
      .run(newContent, row.id);

    const links = extractWikilinks(newContent);
    return {
      frontmatter: fm,
      content: newContent,
      slug: row.slug,
      links,
      backlinks: [],
    };
  }

  /** Get a page by ID */
  getById(id: string): Page | null {
    const row = this.db
      .prepare("SELECT slug FROM pages WHERE id = ?")
      .get(id) as { slug: string } | undefined;
    if (!row) return null;
    return this.getBySlug(row.slug);
  }

  /**
   * Update a page by ID. User-driven edits go through this. Supports
   * changing the title (which may require renaming the file), the
   * markdown content, or the tags. Pass undefined to leave a field
   * unchanged.
   */
  updateById(
    id: string,
    edits: { title?: string; content?: string; tags?: string[] }
  ): Page | null {
    const row = this.db
      .prepare("SELECT slug FROM pages WHERE id = ?")
      .get(id) as { slug: string } | undefined;
    if (!row) return null;

    const oldFilePath = path.join(getPagesDir(), `${row.slug}.md`);
    if (!fs.existsSync(oldFilePath)) return null;

    const raw = fs.readFileSync(oldFilePath, "utf-8");
    const parsed = matter(raw);
    const fm = parsed.data as PageFrontmatter;

    // Title change → may require a slug rename
    let newSlug = row.slug;
    if (edits.title !== undefined && edits.title.trim() !== "" && edits.title !== fm.title) {
      fm.title = edits.title.trim();
      const desiredSlug = slugify(fm.title);
      if (desiredSlug && desiredSlug !== row.slug) {
        // Check for collision
        const collision = this.db
          .prepare("SELECT id FROM pages WHERE slug = ? AND id != ?")
          .get(desiredSlug, id) as { id: string } | undefined;
        newSlug = collision
          ? `${desiredSlug}-${id.slice(-6).toLowerCase()}`
          : desiredSlug;
      }
    }

    if (edits.tags !== undefined) {
      fm.tags = edits.tags;
    }

    const newContent =
      edits.content !== undefined ? edits.content : parsed.content;

    const now = new Date().toISOString();
    fm.modified = now;

    // Write to new file path (may be the same as old)
    const newFilePath = path.join(getPagesDir(), `${newSlug}.md`);
    const fileContent = matter.stringify(newContent, fm);
    fs.writeFileSync(newFilePath, fileContent, "utf-8");

    // If slug changed, remove the old file
    if (newSlug !== row.slug && fs.existsSync(oldFilePath)) {
      fs.unlinkSync(oldFilePath);
    }

    // Update SQLite index
    this.db
      .prepare(
        "UPDATE pages SET slug = ?, title = ?, tags = ?, modified_at = ? WHERE id = ?"
      )
      .run(newSlug, fm.title, JSON.stringify(fm.tags), now, id);

    // Update FTS
    this.db
      .prepare(
        `UPDATE pages_fts SET title = ?, content = ?, tags = ?
         WHERE rowid = (SELECT rowid FROM pages WHERE id = ?)`
      )
      .run(fm.title, newContent, fm.tags.join(" "), id);

    const links = extractWikilinks(newContent);
    return {
      frontmatter: fm,
      content: newContent,
      slug: newSlug,
      links,
      backlinks: [],
    };
  }

  /** Get a page by slug */
  getBySlug(slug: string): Page | null {
    const filePath = path.join(getPagesDir(), `${slug}.md`);
    if (!fs.existsSync(filePath)) return null;

    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = matter(raw);
    const fm = parsed.data as PageFrontmatter;
    const links = extractWikilinks(parsed.content);

    return {
      frontmatter: fm,
      content: parsed.content,
      slug,
      links,
      backlinks: [],
    };
  }

  /** List all pages */
  listAll(): Array<{ id: string; slug: string; title: string; tags: string[] }> {
    return (
      this.db.prepare("SELECT id, slug, title, tags FROM pages ORDER BY modified_at DESC").all() as Array<{
        id: string;
        slug: string;
        title: string;
        tags: string;
      }>
    ).map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      tags: JSON.parse(row.tags),
    }));
  }

  /** Get all page titles (for duplicate detection in LLM context) */
  allTitles(): string[] {
    return (
      this.db.prepare("SELECT title FROM pages").all() as Array<{ title: string }>
    ).map((r) => r.title);
  }

  /** Full-text search */
  search(query: string, limit = 10): Page[] {
    // Sanitize query for FTS5. FTS5 has its own query language with
    // operators like `column:term`, AND/OR/NOT, quotes, parens, etc.
    // To safely accept any user/LLM input, strip non-word chars and
    // wrap each remaining token in double quotes (treating each as
    // a literal phrase). This avoids "no such column" errors when
    // an unrelated word follows a colon.
    const safeQuery = query
      .replace(/[^\w\s'-]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .map((t) => `"${t.replace(/"/g, '""')}"`)
      .join(" ");

    if (!safeQuery) return [];

    let rows: Array<{ slug: string }> = [];
    try {
      rows = this.db
        .prepare(
          `SELECT p.slug FROM pages_fts f
           JOIN pages p ON p.rowid = f.rowid
           WHERE pages_fts MATCH ?
           ORDER BY rank
           LIMIT ?`
        )
        .all(safeQuery, limit) as Array<{ slug: string }>;
    } catch (err) {
      // If FTS5 still rejects the query for some reason, return empty
      // rather than crashing the caller.
      console.warn(`[page-store] search failed for "${query}":`, err);
      return [];
    }

    return rows
      .map((r) => this.getBySlug(r.slug))
      .filter((p): p is Page => p !== null);
  }

  /** Delete a page by ID */
  delete(id: string): boolean {
    const row = this.db
      .prepare("SELECT slug FROM pages WHERE id = ?")
      .get(id) as { slug: string } | undefined;
    if (!row) return false;

    const filePath = path.join(getPagesDir(), `${row.slug}.md`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    this.db
      .prepare(
        "DELETE FROM pages_fts WHERE rowid = (SELECT rowid FROM pages WHERE id = ?)"
      )
      .run(id);
    this.db.prepare("DELETE FROM links WHERE source_id = ? OR target_id = ?").run(id, id);
    this.db.prepare("DELETE FROM pages WHERE id = ?").run(id);

    return true;
  }

  /** Resolve a title or slug to a page ID. Used by the auto-organizer. */
  resolveToId(titleOrSlug: string): string | null {
    // Try slug first
    const bySlug = this.db
      .prepare("SELECT id FROM pages WHERE slug = ?")
      .get(slugify(titleOrSlug)) as { id: string } | undefined;
    if (bySlug) return bySlug.id;

    // Try title (case-insensitive)
    const byTitle = this.db
      .prepare("SELECT id FROM pages WHERE LOWER(title) = LOWER(?)")
      .get(titleOrSlug) as { id: string } | undefined;
    if (byTitle) return byTitle.id;

    // Try aliases
    const allPages = this.db
      .prepare("SELECT id, aliases FROM pages")
      .all() as Array<{ id: string; aliases: string }>;
    for (const row of allPages) {
      const aliases: string[] = JSON.parse(row.aliases);
      if (aliases.some((a) => a.toLowerCase() === titleOrSlug.toLowerCase())) {
        return row.id;
      }
    }

    return null;
  }

  /** Load all pages from disk into SQLite (startup rebuild) */
  rebuildIndex(): void {
    const pagesDir = getPagesDir();
    if (!fs.existsSync(pagesDir)) return;

    const files = fs.readdirSync(pagesDir).filter((f) => f.endsWith(".md"));

    // Clear existing index
    this.db.exec("DELETE FROM pages_fts");
    this.db.exec("DELETE FROM links");
    this.db.exec("DELETE FROM pages");

    for (const file of files) {
      const slug = file.replace(/\.md$/, "");
      const raw = fs.readFileSync(path.join(pagesDir, file), "utf-8");
      const parsed = matter(raw);
      const fm = parsed.data as PageFrontmatter;

      if (!fm.id) continue; // Skip files without proper frontmatter

      this.db
        .prepare(
          `INSERT OR REPLACE INTO pages (id, slug, title, tags, aliases, source, created_at, modified_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          fm.id,
          slug,
          fm.title ?? slug,
          JSON.stringify(fm.tags ?? []),
          JSON.stringify(fm.aliases ?? []),
          fm.source ?? "manual",
          fm.created ?? new Date().toISOString(),
          fm.modified ?? new Date().toISOString()
        );

      this.db
        .prepare(
          `INSERT INTO pages_fts (rowid, title, content, tags)
           VALUES ((SELECT rowid FROM pages WHERE id = ?), ?, ?, ?)`
        )
        .run(fm.id, fm.title ?? slug, parsed.content, (fm.tags ?? []).join(" "));
    }
  }
}
