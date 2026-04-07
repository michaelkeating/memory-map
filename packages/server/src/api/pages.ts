import type { FastifyInstance } from "fastify";
import type { PageStore } from "../storage/page-store.js";
import type { AssociationStore } from "../storage/association-store.js";
import type { LinkIndex } from "../engine/link-index.js";

export function registerPageRoutes(
  app: FastifyInstance,
  pageStore: PageStore,
  associationStore: AssociationStore,
  linkIndex: LinkIndex
) {
  // List all pages
  app.get("/api/pages", async () => {
    return pageStore.listAll();
  });

  // Get a page by ID
  app.get<{ Params: { id: string } }>("/api/pages/:id", async (request, reply) => {
    const page = pageStore.getById(request.params.id);
    if (!page) return reply.code(404).send({ error: "Page not found" });

    // Populate backlinks
    const backlinkIds = linkIndex.getBacklinks(request.params.id);
    page.backlinks = backlinkIds;

    return page;
  });

  // Get backlinks for a page
  app.get<{ Params: { id: string } }>("/api/pages/:id/backlinks", async (request) => {
    const backlinkIds = linkIndex.getBacklinks(request.params.id);
    return backlinkIds.map((id) => pageStore.getById(id)).filter(Boolean);
  });

  // Get associations for a page
  app.get<{ Params: { id: string } }>("/api/pages/:id/associations", async (request) => {
    return associationStore.getForPage(request.params.id);
  });

  // Delete a page
  app.delete<{ Params: { id: string } }>("/api/pages/:id", async (request, reply) => {
    const deleted = pageStore.delete(request.params.id);
    if (!deleted) return reply.code(404).send({ error: "Page not found" });
    return { ok: true };
  });

  // Search
  app.get<{ Querystring: { q: string; limit?: string } }>(
    "/api/search",
    async (request, reply) => {
      const { q, limit } = request.query;
      if (!q?.trim()) return reply.code(400).send({ error: "Query required" });
      return pageStore.search(q, parseInt(limit ?? "10", 10));
    }
  );
}
