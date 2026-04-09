import type { FastifyInstance } from "fastify";
import type { ConnectorStore } from "../connectors/store.js";
import type { ConnectorRunner } from "../connectors/runner.js";

export function registerConnectorRoutes(
  app: FastifyInstance,
  connectorStore: ConnectorStore,
  runner: ConnectorRunner
) {
  app.get("/api/connectors", async () => {
    return connectorStore.list();
  });

  app.get("/api/connectors/types", async () => {
    return runner.getTypeInfo();
  });

  app.get<{ Params: { id: string } }>(
    "/api/connectors/:id",
    async (request, reply) => {
      const c = connectorStore.getById(request.params.id);
      if (!c) return reply.code(404).send({ error: "Connector not found" });
      return c;
    }
  );

  app.put<{
    Params: { id: string };
    Body: { enabled?: boolean; config?: Record<string, unknown> };
  }>("/api/connectors/:id", async (request, reply) => {
    const c = connectorStore.getById(request.params.id);
    if (!c) return reply.code(404).send({ error: "Connector not found" });

    if (request.body.config !== undefined) {
      connectorStore.updateConfig(c.id, { ...c.config, ...request.body.config });
    }
    if (request.body.enabled !== undefined) {
      connectorStore.setEnabled(c.id, request.body.enabled);
      runner.applyEnabledState(c.type);
    }
    return connectorStore.getById(c.id);
  });

  // Trigger a sync. Connector syncs can take minutes (Notion paging,
  // rate limits, LLM calls per item) so we kick off the work in the
  // background and return immediately. The client can poll
  // GET /api/connectors to see when lastSyncAt updates and what the
  // result was.
  app.post<{ Params: { id: string } }>(
    "/api/connectors/:id/sync",
    async (request, reply) => {
      const c = connectorStore.getById(request.params.id);
      if (!c) return reply.code(404).send({ error: "Connector not found" });

      // Validate it can start (so we surface "already running" errors
      // to the client immediately rather than running into them later)
      try {
        // Fire-and-forget. Errors are recorded in connector.lastError
        // by the runner so the UI sees them via /api/connectors.
        runner.runOnce(c.type).catch((err) => {
          console.error(`[connector:${c.type}] background sync error:`, err);
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.code(500).send({ error: "Sync failed", detail: msg });
      }

      return { ok: true, started: true };
    }
  );
}
