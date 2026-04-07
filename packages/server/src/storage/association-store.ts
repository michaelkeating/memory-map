import { ulid } from "ulid";
import type Database from "better-sqlite3";
import type {
  Association,
  CreateAssociationOp,
  UpdateAssociationOp,
} from "@memory-map/shared";
import type { PageStore } from "./page-store.js";

export class AssociationStore {
  constructor(
    private db: Database.Database,
    private pageStore: PageStore
  ) {}

  /** Create a new semantic association */
  create(op: CreateAssociationOp, modelId: string): Association | null {
    const sourceId = this.pageStore.resolveToId(op.source);
    const targetId = this.pageStore.resolveToId(op.target);
    if (!sourceId || !targetId) return null;

    const now = new Date().toISOString();
    const id = ulid();

    const association: Association = {
      id,
      sourceId,
      targetId,
      type: op.type,
      weight: Math.max(0, Math.min(1, op.weight)),
      reason: op.reason,
      createdBy: modelId,
      createdAt: now,
      updatedAt: now,
      stale: false,
    };

    this.db
      .prepare(
        `INSERT INTO associations (id, source_id, target_id, type, weight, reason, created_by, created_at, updated_at, stale)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
      )
      .run(id, sourceId, targetId, op.type, association.weight, op.reason, modelId, now, now);

    // Audit log
    this.db
      .prepare(
        `INSERT INTO association_log (id, association_id, action, new_weight, model_id, timestamp, reason)
         VALUES (?, ?, 'created', ?, ?, ?, ?)`
      )
      .run(ulid(), id, association.weight, modelId, now, op.reason);

    return association;
  }

  /** Update an existing association's weight */
  update(op: UpdateAssociationOp, modelId: string): Association | null {
    const sourceId = this.pageStore.resolveToId(op.source);
    const targetId = this.pageStore.resolveToId(op.target);
    if (!sourceId || !targetId) return null;

    const existing = this.db
      .prepare(
        "SELECT * FROM associations WHERE source_id = ? AND target_id = ? AND stale = 0"
      )
      .get(sourceId, targetId) as any;
    if (!existing) return null;

    const now = new Date().toISOString();
    const newWeight = Math.max(0, Math.min(1, op.newWeight));

    this.db
      .prepare(
        "UPDATE associations SET weight = ?, updated_at = ?, reason = ? WHERE id = ?"
      )
      .run(newWeight, now, op.reason, existing.id);

    // Audit log
    this.db
      .prepare(
        `INSERT INTO association_log (id, association_id, action, old_weight, new_weight, model_id, timestamp, reason)
         VALUES (?, ?, 'updated', ?, ?, ?, ?, ?)`
      )
      .run(ulid(), existing.id, existing.weight, newWeight, modelId, now, op.reason);

    return {
      id: existing.id,
      sourceId,
      targetId,
      type: existing.type,
      weight: newWeight,
      reason: op.reason,
      createdBy: existing.created_by,
      createdAt: existing.created_at,
      updatedAt: now,
      stale: false,
    };
  }

  /** Get all associations for a page (as source or target) */
  getForPage(pageId: string): Association[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM associations
           WHERE (source_id = ? OR target_id = ?) AND stale = 0
           ORDER BY weight DESC`
        )
        .all(pageId, pageId) as any[]
    ).map(rowToAssociation);
  }

  /** Get associations between a set of page IDs */
  getBetween(pageIds: string[]): Association[] {
    if (pageIds.length === 0) return [];
    const placeholders = pageIds.map(() => "?").join(",");
    return (
      this.db
        .prepare(
          `SELECT * FROM associations
           WHERE source_id IN (${placeholders}) AND target_id IN (${placeholders}) AND stale = 0
           ORDER BY weight DESC`
        )
        .all(...pageIds, ...pageIds) as any[]
    ).map(rowToAssociation);
  }

  /** Get all non-stale associations */
  getAll(): Association[] {
    return (
      this.db
        .prepare("SELECT * FROM associations WHERE stale = 0 ORDER BY weight DESC")
        .all() as any[]
    ).map(rowToAssociation);
  }
}

function rowToAssociation(row: any): Association {
  return {
    id: row.id,
    sourceId: row.source_id,
    targetId: row.target_id,
    type: row.type,
    weight: row.weight,
    reason: row.reason,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stale: Boolean(row.stale),
  };
}
