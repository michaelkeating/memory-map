import type { GraphData, GraphNode, GraphEdge } from "@memory-map/shared";
import type { PageStore } from "../storage/page-store.js";
import type { AssociationStore } from "../storage/association-store.js";
import type { LinkIndex } from "./link-index.js";

export class GraphService {
  constructor(
    private pageStore: PageStore,
    private associationStore: AssociationStore,
    private linkIndex: LinkIndex
  ) {}

  getFullGraph(): GraphData {
    const pages = this.pageStore.listAll();

    const nodes: GraphNode[] = pages.map((p) => {
      const forwardLinks = this.linkIndex.getForwardLinks(p.id);
      const backlinks = this.linkIndex.getBacklinks(p.id);
      return {
        id: p.id,
        title: p.title,
        slug: p.slug,
        tags: p.tags,
        linkCount: forwardLinks.length + backlinks.length,
      };
    });

    // Explicit link edges
    const explicitEdges: GraphEdge[] = this.linkIndex
      .getAllEdges()
      .map((e) => ({
        source: e.source,
        target: e.target,
        type: "explicit" as const,
        weight: 1.0,
      }));

    // Semantic association edges
    const associations = this.associationStore.getAll();
    const semanticEdges: GraphEdge[] = associations.map((a) => ({
      source: a.sourceId,
      target: a.targetId,
      type: a.type,
      weight: a.weight,
    }));

    return {
      nodes,
      edges: [...explicitEdges, ...semanticEdges],
    };
  }
}
