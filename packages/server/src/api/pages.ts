import type { FastifyInstance } from "fastify";
import type { PageStore } from "../storage/page-store.js";
import type { AssociationStore } from "../storage/association-store.js";
import type { LinkIndex } from "../engine/link-index.js";
import type { ProfileService } from "../llm/profile-service.js";
import type { GraphService } from "../engine/graph-service.js";
import type { WebSocketHub } from "../ws/hub.js";
import type { SourceStore } from "../storage/source-store.js";

export function registerPageRoutes(
  app: FastifyInstance,
  pageStore: PageStore,
  associationStore: AssociationStore,
  linkIndex: LinkIndex,
  profileService: ProfileService,
  graphService: GraphService,
  wsHub: WebSocketHub,
  sourceStore: SourceStore
) {
  // List all pages
  app.get("/api/pages", async () => {
    return pageStore.listAll();
  });

  // Create a new page (user-driven)
  app.post<{
    Body: { title: string; content?: string; tags?: string[] };
  }>("/api/pages", async (request, reply) => {
    const { title, content, tags } = request.body ?? {};
    if (!title || !title.trim()) {
      return reply.code(400).send({ error: "Title is required" });
    }

    const page = pageStore.create(
      {
        title: title.trim(),
        content: content ?? "",
        tags: tags ?? [],
        aliases: [],
      },
      "manual"
    );

    // Index the (probably empty) wikilinks
    linkIndex.updateForPage(page.frontmatter.id, page.links);

    // Notify clients
    wsHub.broadcast({ type: "page:created", page });
    const graph = graphService.getFullGraph();
    wsHub.broadcast({ type: "graph:full", graph });

    return page;
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

  // Update a page (user-driven edit)
  app.put<{
    Params: { id: string };
    Body: { title?: string; content?: string; tags?: string[] };
  }>("/api/pages/:id", async (request, reply) => {
    const { id } = request.params;
    const page = pageStore.updateById(id, request.body ?? {});
    if (!page) return reply.code(404).send({ error: "Page not found" });

    // Re-parse wikilinks and update the link index
    linkIndex.updateForPage(id, page.links);

    // Profile is no longer current
    profileService.markStale(id);

    // Notify clients
    wsHub.broadcast({ type: "page:updated", page });

    // Push the new graph (link index changes affect edges)
    const graph = graphService.getFullGraph();
    wsHub.broadcast({ type: "graph:full", graph });

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

  // Delete a page. By default this also blocks the source memories that
  // contributed to it so the next connector sync won't re-create it.
  // Pass ?keepSources=true to skip the cascade-block.
  app.delete<{
    Params: { id: string };
    Querystring: { keepSources?: string };
  }>("/api/pages/:id", async (request, reply) => {
    const { id } = request.params;

    // Block sources BEFORE deleting (we need page_sources rows to find them)
    let blockedSources = 0;
    if (request.query.keepSources !== "true") {
      blockedSources = sourceStore.blockSourcesForPage(id);
    }

    const deleted = pageStore.delete(id);
    if (!deleted) return reply.code(404).send({ error: "Page not found" });

    // Notify clients
    wsHub.broadcast({ type: "page:deleted", pageId: id });
    const graph = graphService.getFullGraph();
    wsHub.broadcast({ type: "graph:full", graph });

    return { ok: true, blockedSources };
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
