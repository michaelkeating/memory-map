import { create } from "zustand";
import type {
  GraphData,
  GraphNode,
  GraphEdge,
  Page,
  Association,
} from "@memory-map/shared";
import {
  type Category,
  DEFAULT_CATEGORIES,
  nextCustomColor,
} from "../components/graph/categories.js";

const CATEGORIES_STORAGE_KEY = "memorymap.categories.v1";

function loadCategories(): Category[] {
  if (typeof window === "undefined") return [...DEFAULT_CATEGORIES];
  try {
    const raw = window.localStorage.getItem(CATEGORIES_STORAGE_KEY);
    if (!raw) return [...DEFAULT_CATEGORIES];
    const parsed = JSON.parse(raw) as Category[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [...DEFAULT_CATEGORIES];
    }
    // Make sure we still have all four builtins (in case the user
    // had old persisted state from before some were added)
    const ids = new Set(parsed.map((c) => c.id));
    for (const def of DEFAULT_CATEGORIES) {
      if (!ids.has(def.id)) parsed.push({ ...def });
    }
    return parsed;
  } catch {
    return [...DEFAULT_CATEGORIES];
  }
}

function persistCategories(categories: Category[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      CATEGORIES_STORAGE_KEY,
      JSON.stringify(categories)
    );
  } catch {
    // ignore
  }
}

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
  categories: Category[];

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
  toggleCategoryVisibility: (id: string) => void;
  addCustomCategory: (label: string, tag: string) => void;
  removeCategory: (id: string) => void;
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

  categories: loadCategories(),

  toggleCategoryVisibility: (id) =>
    set((state) => {
      const next = state.categories.map((c) =>
        c.id === id ? { ...c, visible: !c.visible } : c
      );
      persistCategories(next);
      return { categories: next };
    }),

  addCustomCategory: (label, tag) =>
    set((state) => {
      // Don't allow duplicate categories for the same tag
      if (state.categories.some((c) => c.tags.includes(tag) && !c.builtin)) {
        return {};
      }
      const customCount = state.categories.filter((c) => !c.builtin).length;
      const newCategory: Category = {
        id: `custom-${Date.now()}`,
        label: label.trim() || tag,
        tags: [tag],
        visible: true,
        builtin: false,
        customColor: nextCustomColor(customCount),
      };
      // Insert before the default ("concept") category so the fallback
      // stays at the end of the matching priority list
      const defaultIdx = state.categories.findIndex(
        (c) => c.tags.length === 0
      );
      const next = [...state.categories];
      if (defaultIdx >= 0) {
        next.splice(defaultIdx, 0, newCategory);
      } else {
        next.push(newCategory);
      }
      persistCategories(next);
      return { categories: next };
    }),

  removeCategory: (id) =>
    set((state) => {
      const next = state.categories.filter(
        (c) => c.id !== id || c.builtin
      );
      persistCategories(next);
      return { categories: next };
    }),

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
