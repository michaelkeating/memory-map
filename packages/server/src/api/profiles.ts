import type { FastifyInstance } from "fastify";
import type { SourceStore } from "../storage/source-store.js";
import type { ProfileService } from "../llm/profile-service.js";
import type { GraphService } from "../engine/graph-service.js";
import type { WebSocketHub } from "../ws/hub.js";

export function registerProfileRoutes(
  app: FastifyInstance,
  sourceStore: SourceStore,
  profileService: ProfileService,
  graphService: GraphService,
  wsHub: WebSocketHub
) {
  // List source memories that contributed to a page
  app.get<{ Params: { id: string } }>(
    "/api/pages/:id/sources",
    async (request) => {
      return sourceStore.getPageSources(request.params.id);
    }
  );

  // List source memories that contributed to an association
  app.get<{ Params: { id: string } }>(
    "/api/associations/:id/sources",
    async (request) => {
      return sourceStore.getAssociationSources(request.params.id);
    }
  );

  // Get a single source memory
  app.get<{ Params: { id: string } }>(
    "/api/sources/:id",
    async (request, reply) => {
      const source = sourceStore.getById(request.params.id);
      if (!source) return reply.code(404).send({ error: "Not found" });
      return source;
    }
  );

  /**
   * Permanently delete a source memory. Wipes its content but leaves
   * a tombstone row with blocked=1 so future syncs skip its external
   * id. Removes the page_sources / association_sources rows so the
   * source vanishes from any page's source list — but leaves the
   * pages and associations themselves untouched.
   */
  app.delete<{ Params: { id: string } }>(
    "/api/sources/:id",
    async (request, reply) => {
      const id = request.params.id;
      const source = sourceStore.getById(id);
      if (!source) return reply.code(404).send({ error: "Not found" });

      const result = sourceStore.permanentlyDelete(id);

      // Push a graph refresh in case anything UI-visible changed
      const graph = graphService.getFullGraph();
      wsHub.broadcast({ type: "graph:full", graph });

      return result;
    }
  );

  /** Count of pages that currently reference this source */
  app.get<{ Params: { id: string } }>(
    "/api/sources/:id/page-count",
    async (request) => {
      return { count: sourceStore.countPagesUsingSource(request.params.id) };
    }
  );

  // Get cached profile for a page (or null if none yet)
  app.get<{ Params: { id: string } }>(
    "/api/pages/:id/profile",
    async (request) => {
      return profileService.getCached(request.params.id);
    }
  );

  // Generate or refresh profile for a page (lazy: only regenerates if stale)
  app.post<{ Params: { id: string }; Querystring: { force?: string } }>(
    "/api/pages/:id/profile/generate",
    async (request, reply) => {
      try {
        const force = request.query.force === "true";
        const profile = force
          ? await profileService.generate(request.params.id)
          : await profileService.getOrGenerate(request.params.id);
        if (!profile) return reply.code(404).send({ error: "Page not found" });
        return profile;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.code(500).send({ error: "Profile generation failed", detail: msg });
      }
    }
  );
}
