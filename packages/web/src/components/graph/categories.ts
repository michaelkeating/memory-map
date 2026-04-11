import type { GraphStyle, RGB } from "./styles.js";

export interface Category {
  /** Stable identifier */
  id: string;
  /** Display label in the legend */
  label: string;
  /** Tags this category matches. Empty array = the "default" category
   * which catches anything no other category claims. */
  tags: string[];
  /** Currently shown in the graph? */
  visible: boolean;
  /** Built-in categories use the active style's palette and can't be
   * removed. Custom categories use their own customColor. */
  builtin: boolean;
  /** Color for custom (non-builtin) categories */
  customColor?: RGB;
}

/** The four built-in categories the LLM uses out of the box */
export const DEFAULT_CATEGORIES: Category[] = [
  {
    id: "person",
    label: "Person",
    tags: ["person"],
    visible: true,
    builtin: true,
  },
  {
    id: "project",
    label: "Project",
    tags: ["project"],
    visible: true,
    builtin: true,
  },
  {
    id: "company",
    label: "Company",
    tags: ["company", "organization"],
    visible: true,
    builtin: true,
  },
  {
    id: "concept",
    label: "Concept",
    // Empty tags = the "everything else" fallback
    tags: [],
    visible: true,
    builtin: true,
  },
];

/**
 * Find the category that owns a node. Iterates non-default categories
 * first and returns the first one whose tags match. Falls back to the
 * default (no-tags) category if any exists.
 */
export function findCategoryForNode(
  nodeTags: string[],
  categories: Category[]
): Category | null {
  for (const cat of categories) {
    if (cat.tags.length === 0) continue;
    if (cat.tags.some((t) => nodeTags.includes(t))) return cat;
  }
  return categories.find((c) => c.tags.length === 0) ?? null;
}

/**
 * Get the RGB color for a node based on its matching category.
 * Built-in categories use the active style's palette so each style
 * keeps its own visual identity. Custom categories use their own
 * customColor.
 */
export function getNodeCategoryColor(
  nodeTags: string[],
  categories: Category[],
  style: GraphStyle
): RGB {
  const cat = findCategoryForNode(nodeTags, categories);
  if (!cat) return style.node.colors.default;
  if (cat.builtin) {
    switch (cat.id) {
      case "person":
        return style.node.colors.person;
      case "project":
        return style.node.colors.project;
      case "company":
        return style.node.colors.company;
      case "concept":
      default:
        return style.node.colors.default;
    }
  }
  return cat.customColor ?? style.node.colors.default;
}

/**
 * Convenience: should a node be rendered? True if its matching
 * category is visible (or no category matches at all).
 */
export function isNodeVisible(
  nodeTags: string[],
  categories: Category[]
): boolean {
  const cat = findCategoryForNode(nodeTags, categories);
  return cat?.visible ?? true;
}

/** A palette of distinct colors for newly-added custom categories */
export const CUSTOM_CATEGORY_PALETTE: RGB[] = [
  { r: 244, g: 114, b: 182 }, // pink
  { r: 250, g: 204, b: 21 }, // yellow
  { r: 16, g: 185, b: 129 }, // teal
  { r: 168, g: 85, b: 247 }, // purple
  { r: 239, g: 68, b: 68 }, // red
  { r: 14, g: 165, b: 233 }, // sky
  { r: 132, g: 204, b: 22 }, // lime
  { r: 217, g: 70, b: 239 }, // fuchsia
];

/** Pick the next palette color based on how many custom categories exist */
export function nextCustomColor(usedCount: number): RGB {
  return CUSTOM_CATEGORY_PALETTE[usedCount % CUSTOM_CATEGORY_PALETTE.length];
}
