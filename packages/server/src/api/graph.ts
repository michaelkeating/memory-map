import type { FastifyInstance } from "fastify";
import type { GraphService } from "../engine/graph-service.js";

export function registerGraphRoutes(
  app: FastifyInstance,
  graphService: GraphService
) {
  app.get("/api/graph", async () => {
    return graphService.getFullGraph();
  });

  app.get("/api/graph/stats", async () => {
    const graph = graphService.getFullGraph();
    const explicitEdges = graph.edges.filter((e) => e.type === "explicit");
    const semanticEdges = graph.edges.filter((e) => e.type !== "explicit");
    return {
      nodes: graph.nodes.length,
      explicitEdges: explicitEdges.length,
      semanticEdges: semanticEdges.length,
      totalEdges: graph.edges.length,
    };
  });
}
