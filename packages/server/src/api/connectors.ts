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

  app.post<{ Params: { id: string } }>(
    "/api/connectors/:id/sync",
    async (request, reply) => {
      const c = connectorStore.getById(request.params.id);
      if (!c) return reply.code(404).send({ error: "Connector not found" });

      try {
        await runner.runOnce(c.type);
        const updated = connectorStore.getById(c.id);
        return { ok: true, connector: updated };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.code(500).send({ error: "Sync failed", detail: msg });
      }
    }
  );
}
