import { create } from "zustand";
import type {
  GraphData,
  GraphNode,
  GraphEdge,
  Page,
  Association,
} from "@memory-map/shared";

interface GraphStore {
  nodes: GraphNode[];
  edges: GraphEdge[];
  freshNodes: Set<string>;

  setGraph: (g: GraphData) => void;
  addNode: (page: Page) => void;
  updateNode: (page: Page) => void;
  addEdge: (assoc: Association) => void;
  updateEdge: (assoc: Association) => void;
}

export const useGraphStore = create<GraphStore>((set) => ({
  nodes: [],
  edges: [],
  freshNodes: new Set(),

  setGraph: (g) => set({ nodes: g.nodes, edges: g.edges }),

  addNode: (page) =>
    set((state) => {
      // Avoid duplicate
      if (state.nodes.some((n) => n.id === page.frontmatter.id)) return state;

      const node: GraphNode = {
        id: page.frontmatter.id,
        title: page.frontmatter.title,
        slug: page.slug,
        tags: page.frontmatter.tags,
        linkCount: page.links.length,
      };
      const freshNodes = new Set(state.freshNodes);
      freshNodes.add(node.id);
      setTimeout(() => {
        set((s) => {
          const f = new Set(s.freshNodes);
          f.delete(node.id);
          return { freshNodes: f };
        });
      }, 2000);
      return { nodes: [...state.nodes, node], freshNodes };
    }),

  updateNode: (page) =>
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === page.frontmatter.id
          ? {
              ...n,
              title: page.frontmatter.title,
              tags: page.frontmatter.tags,
              linkCount: page.links.length,
            }
          : n
      ),
    })),

  addEdge: (assoc) =>
    set((state) => ({
      edges: [
        ...state.edges,
        {
          source: assoc.sourceId,
          target: assoc.targetId,
          type: assoc.type,
          weight: assoc.weight,
        },
      ],
    })),

  updateEdge: (assoc) =>
    set((state) => ({
      edges: state.edges.map((e) =>
        e.source === assoc.sourceId && e.target === assoc.targetId
          ? { ...e, weight: assoc.weight, type: assoc.type }
          : e
      ),
    })),
}));
