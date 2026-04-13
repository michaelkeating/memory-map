import type { FastifyInstance } from "fastify";
import type { ConnectorStore } from "../connectors/store.js";
import type { SourceStore } from "../storage/source-store.js";
import type { AutoOrganizer } from "../llm/auto-organizer.js";
import type { GraphService } from "../engine/graph-service.js";
import type { WebSocketHub } from "../ws/hub.js";

interface ScreenpipeMemory {
  id: number;
  content: string;
  source: string;
  tags: string[];
  importance: number;
  frame_id: number | null;
  created_at: string;
  updated_at: string;
}

interface ScreenpipeMemoryListResponse {
  data: ScreenpipeMemory[];
  pagination: { limit: number; offset: number; total: number };
}

/**
 * Routes that let the Memory Map UI browse Screenpipe memories
 * directly and import specific ones on demand. The connector still
 * does its automatic background sync; these endpoints are for the
 * manual curation flow.
 */
export function registerScreenpipeRoutes(
  app: FastifyInstance,
  connectorStore: ConnectorStore,
  sourceStore: SourceStore,
  organizer: AutoOrganizer,
  graphService: GraphService,
  wsHub: WebSocketHub
) {
  function getBaseUrl(): string {
    const c = connectorStore.getByType("screenpipe");
    if (!c) return "http://localhost:3030";
    const url = (c.config as { baseUrl?: string }).baseUrl;
    return url ?? "http://localhost:3030";
  }

  /** List Screenpipe memories with optional filters and import-status flag */
  app.get<{
    Querystring: {
      q?: string;
      source?: string;
      tags?: string;
      min_importance?: string;
      limit?: string;
      offset?: string;
      order_by?: string;
      order_dir?: string;
    };
  }>("/api/screenpipe/memories", async (request, reply) => {
    const baseUrl = getBaseUrl();
    const url = new URL("/memories", baseUrl);

    // Pass through filters that Screenpipe natively understands
    const passthrough = ["q", "source", "tags", "min_importance", "limit", "offset", "order_by", "order_dir"];
    for (const k of passthrough) {
      const v = (request.query as Record<string, string | undefined>)[k];
      if (v != null && v !== "") {
        url.searchParams.set(k, v);
      }
    }
    if (!request.query.limit) url.searchParams.set("limit", "50");
    if (!request.query.order_by) url.searchParams.set("order_by", "created_at");
    if (!request.query.order_dir) url.searchParams.set("order_dir", "desc");

    let json: ScreenpipeMemoryListResponse;
    try {
      const res = await fetch(url.toString());
      if (!res.ok) {
        const text = await res.text();
        return reply
          .code(502)
          .send({ error: `Screenpipe error: ${res.status} ${text.slice(0, 300)}` });
      }
      json = (await res.json()) as ScreenpipeMemoryListResponse;
    } catch (err) {
      return reply.code(502).send({
        error: `Cannot reach Screenpipe at ${baseUrl}`,
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    // Annotate each memory with whether we've already imported it
    const annotated = json.data.map((m) => {
      const existing = checkImported(sourceStore, String(m.id));
      return {
        ...m,
        imported: Boolean(existing),
        importedSourceId: existing?.id ?? null,
      };
    });

    return {
      data: annotated,
      pagination: json.pagination,
    };
  });

  /** Manually import a single Screenpipe memory by its upstream ID */
  app.post<{ Params: { id: string } }>(
    "/api/screenpipe/memories/:id/import",
    async (request, reply) => {
      const baseUrl = getBaseUrl();
      const memoryId = request.params.id;

      // Fetch the memory from Screenpipe
      let memory: ScreenpipeMemory;
      try {
        const res = await fetch(`${baseUrl}/memories/${memoryId}`);
        if (!res.ok) {
          const text = await res.text();
          return reply
            .code(502)
            .send({ error: `Screenpipe error: ${res.status} ${text.slice(0, 300)}` });
        }
        // Screenpipe wraps single-fetch responses too
        const json = (await res.json()) as ScreenpipeMemory | { data: ScreenpipeMemory };
        memory = "data" in json ? (json as { data: ScreenpipeMemory }).data : (json as ScreenpipeMemory);
      } catch (err) {
        return reply.code(502).send({
          error: `Cannot reach Screenpipe at ${baseUrl}`,
          detail: err instanceof Error ? err.message : String(err),
        });
      }

      // Format and ingest using the same auto-organizer pipeline the
      // connector uses
      const blob = formatMemoryForLLM(memory);
      try {
        await organizer.ingest({
          externalSource: "screenpipe",
          externalId: String(memory.id),
          content: blob,
          sourceLabel: `Screenpipe / ${memory.source}`,
          capturedAt: memory.created_at,
          importance: memory.importance,
          tags: memory.tags,
        });
      } catch (err) {
        return reply.code(500).send({
          error: "Import failed",
          detail: err instanceof Error ? err.message : String(err),
        });
      }

      // Push graph update so the UI animates the new content in
      const graph = graphService.getFullGraph();
      wsHub.broadcast({ type: "graph:full", graph });

      return { ok: true };
    }
  );

  /**
   * Push endpoint for the Screenpipe pipe to call. The pipe POSTs the
   * full memory payload here so we don't need to round-trip back to
   * Screenpipe to fetch it. Idempotent — re-importing the same
   * external_id is fine (it just updates the source).
   */
  app.post<{
    Body: {
      external_id?: string | number;
      content?: string;
      source?: string;
      tags?: string[];
      importance?: number;
      created_at?: string;
    };
  }>("/api/screenpipe/push", async (request, reply) => {
    const body = request.body ?? {};
    if (!body.external_id || !body.content) {
      return reply.code(400).send({
        error: "external_id and content are required",
      });
    }

    const memoryLike = {
      id: body.external_id,
      content: body.content,
      source: body.source ?? "pipe-push",
      tags: body.tags ?? [],
      importance: body.importance ?? 0.5,
      created_at: body.created_at ?? new Date().toISOString(),
    };

    const blob = formatMemoryForLLM(memoryLike as any);
    try {
      await organizer.ingest({
        externalSource: "screenpipe",
        externalId: String(memoryLike.id),
        content: blob,
        sourceLabel: `Screenpipe / ${memoryLike.source}`,
        capturedAt: memoryLike.created_at,
        importance: memoryLike.importance,
        tags: memoryLike.tags,
      });
    } catch (err) {
      return reply.code(500).send({
        error: "Push failed",
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    const graph = graphService.getFullGraph();
    wsHub.broadcast({ type: "graph:full", graph });

    return { ok: true };
  });

  /** List distinct sources currently in Screenpipe (for filter dropdown) */
  app.get("/api/screenpipe/sources", async (_request, reply) => {
    const baseUrl = getBaseUrl();
    try {
      // No dedicated endpoint — sample 500 recent and dedupe
      const res = await fetch(`${baseUrl}/memories?limit=500&order_by=created_at&order_dir=desc`);
      if (!res.ok) {
        return reply.code(502).send({ error: `Screenpipe error: ${res.status}` });
      }
      const json = (await res.json()) as ScreenpipeMemoryListResponse;
      const sources = new Set<string>();
      const tags = new Set<string>();
      for (const m of json.data ?? []) {
        if (m.source) sources.add(m.source);
        for (const t of m.tags ?? []) tags.add(t);
      }
      return {
        sources: [...sources].sort(),
        tags: [...tags].sort(),
      };
    } catch (err) {
      return reply.code(502).send({
        error: `Cannot reach Screenpipe`,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // The pipe used to fetch its export rules from this server via
  // /api/screenpipe/pipe-config. As of the decoupling refactor, the
  // pipe reads its rules from ~/.screenpipe/memory-map-rules.json
  // instead. The old endpoints have been removed — the pipe's only
  // remaining contract with the server is POST /api/screenpipe/push
  // (defined above).
}

function checkImported(sourceStore: SourceStore, externalId: string) {
  // SourceStore doesn't have a getByExternal method yet — let's use a simple
  // probe through the DB. To avoid coupling here, we add a small helper
  // method on SourceStore in the next edit.
  return sourceStore.getByExternal("screenpipe", externalId);
}

function formatMemoryForLLM(memory: ScreenpipeMemory): string {
  const parts: string[] = [];
  parts.push(`Memory captured at: ${memory.created_at}`);
  parts.push(`Source: ${memory.source}`);
  parts.push(`Importance: ${memory.importance}`);
  if (memory.tags?.length > 0) {
    parts.push(`Tags: ${memory.tags.join(", ")}`);
  }
  parts.push("");
  parts.push(memory.content);
  return parts.join("\n");
}
