import type { FastifyInstance } from "fastify";
import type { EventLogStore, EventType } from "../storage/event-log-store.js";
import type { PageStore } from "../storage/page-store.js";
import type { SourceStore } from "../storage/source-store.js";

/**
 * Resolve event log rows to display objects, looking up the *current*
 * state of any referenced page or source. Deleted entities show as
 * "[deleted]" / "[removed]" so the log automatically inherits any
 * deletions the user has performed since the event was written.
 */
export function registerLogRoutes(
  app: FastifyInstance,
  eventLog: EventLogStore,
  pageStore: PageStore,
  sourceStore: SourceStore
) {
  app.get<{
    Querystring: { limit?: string; offset?: string; types?: string };
  }>("/api/log", async (request) => {
    const limit = parseInt(request.query.limit ?? "100", 10);
    const offset = parseInt(request.query.offset ?? "0", 10);
    const types = request.query.types
      ? (request.query.types.split(",") as EventType[])
      : undefined;

    const rows = eventLog.list({ limit, offset, types });

    return rows.map((row) => {
      let pageTitle: string | null = null;
      let pageDeleted = false;
      if (row.pageId) {
        const page = pageStore.getById(row.pageId);
        if (page) {
          pageTitle = page.frontmatter.title;
        } else {
          pageDeleted = true;
        }
      }

      let sourceLabel: string | null = null;
      let sourceRemoved = false;
      if (row.sourceId) {
        const src = sourceStore.getById(row.sourceId);
        if (src && src.content && src.content.length > 0) {
          sourceLabel = src.sourceLabel;
        } else {
          sourceRemoved = true;
        }
      }

      return {
        id: row.id,
        type: row.type,
        createdAt: row.createdAt,
        text: row.text,
        meta: row.meta,
        pageId: row.pageId,
        sourceId: row.sourceId,
        // Current-state resolution
        pageTitle,
        pageDeleted,
        sourceLabel,
        sourceRemoved,
      };
    });
  });

  /** Delete a single log entry (used to redact a chat query / lint result) */
  app.delete<{ Params: { id: string } }>("/api/log/:id", async (request, reply) => {
    const ok = eventLog.delete(request.params.id);
    if (!ok) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });

  /** Wipe all chat_query log entries (privacy sweep) */
  app.delete("/api/log/chat-queries/all", async () => {
    const removed = eventLog.clearChatQueries();
    return { ok: true, removed };
  });
}
