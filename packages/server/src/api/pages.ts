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

  // Delete a page. Three modes via query params:
  // - default: block source memories so they won't be re-imported
  // - ?deleteSources=true: PERMANENTLY delete source memories (wipes
  //   their content; removes them from any other page that referenced
  //   them too)
  // - ?keepSources=true: don't touch source memories at all
  app.delete<{
    Params: { id: string };
    Querystring: { keepSources?: string; deleteSources?: string };
  }>("/api/pages/:id", async (request, reply) => {
    const { id } = request.params;
    const deleteSources = request.query.deleteSources === "true";
    const keepSources = request.query.keepSources === "true";

    // Capture the source IDs before we touch anything (page_sources
    // rows get removed by either action)
    const sourceIds = sourceStore.getPageSources(id).map((s) => s.id);

    let blockedSources = 0;
    let deletedSources = 0;
    if (deleteSources) {
      // Permanently delete each source. This also clears the
      // page_sources rows for those sources across all pages.
      for (const sid of sourceIds) {
        const r = sourceStore.permanentlyDelete(sid);
        if (r.deleted) deletedSources++;
      }
    } else if (!keepSources) {
      // Default behavior: block sources so they don't get re-imported
      blockedSources = sourceStore.blockSourcesForPage(id);
    }

    const deleted = pageStore.delete(id);
    if (!deleted) return reply.code(404).send({ error: "Page not found" });

    wsHub.broadcast({ type: "page:deleted", pageId: id });
    const graph = graphService.getFullGraph();
    wsHub.broadcast({ type: "graph:full", graph });

    return { ok: true, blockedSources, deletedSources };
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
