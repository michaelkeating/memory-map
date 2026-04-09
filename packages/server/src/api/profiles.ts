import type { FastifyInstance } from "fastify";
import type { SourceStore } from "../storage/source-store.js";
import type { ProfileService } from "../llm/profile-service.js";

export function registerProfileRoutes(
  app: FastifyInstance,
  sourceStore: SourceStore,
  profileService: ProfileService
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
