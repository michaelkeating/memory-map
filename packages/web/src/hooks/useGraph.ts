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
  pinnedIds: Set<string>;
  /** Pages the chat surfaced in its last response */
  focusedIds: Set<string>;
  /** The page currently open in the side panel — also gets highlighted */
  activePageId: string | null;
  graphStyleId: string;

  setGraph: (g: GraphData) => void;
  addNode: (page: Page) => void;
  updateNode: (page: Page) => void;
  addEdge: (assoc: Association) => void;
  updateEdge: (assoc: Association) => void;
  pin: (id: string) => void;
  unpin: (id: string) => void;
  togglePin: (id: string) => void;
  setGraphStyle: (id: string) => void;
  setFocusedIds: (ids: string[]) => void;
  clearFocus: () => void;
  setActivePageId: (id: string | null) => void;
}

export const useGraphStore = create<GraphStore>((set) => ({
  nodes: [],
  edges: [],
  freshNodes: new Set(),
  pinnedIds: new Set(),
  focusedIds: new Set(),
  activePageId: null,
  graphStyleId: "clean",

  setGraph: (g) => set({ nodes: g.nodes, edges: g.edges }),

  setGraphStyle: (id) => set({ graphStyleId: id }),

  setFocusedIds: (ids) => set({ focusedIds: new Set(ids) }),
  clearFocus: () => set({ focusedIds: new Set() }),
  setActivePageId: (id) => set({ activePageId: id }),

  pin: (id) =>
    set((state) => {
      const next = new Set(state.pinnedIds);
      next.add(id);
      return { pinnedIds: next };
    }),

  unpin: (id) =>
    set((state) => {
      const next = new Set(state.pinnedIds);
      next.delete(id);
      return { pinnedIds: next };
    }),

  togglePin: (id) =>
    set((state) => {
      const next = new Set(state.pinnedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { pinnedIds: next };
    }),

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
