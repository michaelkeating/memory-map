// === IDs (ULID - lexicographically sortable, timestamp-embedded) ===
export type PageId = string;
export type AssociationId = string;

// === Page ===
export interface PageFrontmatter {
  id: PageId;
  title: string;
  created: string; // ISO 8601
  modified: string;
  tags: string[];
  aliases: string[];
  source: "chat" | "connector" | "manual";
}

export interface Page {
  frontmatter: PageFrontmatter;
  content: string; // markdown body (without frontmatter)
  slug: string; // filename stem, e.g. "distributed-systems"
  links: string[]; // outgoing wikilink target titles
  backlinks: string[]; // populated at query time
}

// === Association ===
export const ASSOCIATION_TYPES = [
  "related_to",
  "informed_by",
  "contradicts",
  "alternative_to",
  "stakeholder",
  "evolved_into",
  "depends_on",
  "instance_of",
] as const;
export type AssociationType = (typeof ASSOCIATION_TYPES)[number];

export interface Association {
  id: AssociationId;
  sourceId: PageId;
  targetId: PageId;
  type: AssociationType;
  weight: number; // 0.0 - 1.0
  reason: string;
  createdBy: string; // model identifier
  createdAt: string;
  updatedAt: string;
  stale: boolean;
}

// === Graph (for visualization) ===
export interface GraphNode {
  id: PageId;
  title: string;
  slug: string;
  tags: string[];
  linkCount: number;
  x?: number;
  y?: number;
  pinned?: boolean;
}

export interface GraphEdge {
  source: PageId;
  target: PageId;
  type: "explicit" | AssociationType;
  weight: number; // 1.0 for explicit links
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// === WebSocket Events ===
export type WSEvent =
  | { type: "page:created"; page: Page }
  | { type: "page:updated"; page: Page }
  | { type: "page:deleted"; pageId: PageId }
  | { type: "association:created"; association: Association }
  | { type: "association:updated"; association: Association }
  | { type: "chat:chunk"; content: string }
  | { type: "chat:done"; content: string }
  | { type: "graph:full"; graph: GraphData };

// === Chat ===
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  graphDelta?: {
    pagesCreated: string[];
    pagesUpdated: string[];
    associationsCreated: AssociationId[];
  };
}

// === API Responses ===
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  offset: number;
  limit: number;
}

// === Source memories (provenance) ===
export interface MemorySource {
  id: string;
  externalSource: string;   // "screenpipe", "gmail", etc.
  externalId: string;
  content: string;
  sourceLabel: string;
  tags: string[];
  importance: number | null;
  capturedAt: string;
  ingestedAt: string;
}

/**
 * Structured payload that connectors pass to the auto-organizer
 * for ingestion. Lets us record provenance for every page and
 * association created.
 */
export interface IngestionSource {
  externalSource: string;
  externalId: string;
  content: string;
  sourceLabel: string;
  capturedAt: string;
  importance?: number;
  tags?: string[];
}

// === Page profile (synthesized) ===
export interface PageProfile {
  pageId: string;
  profileMd: string;
  sourceCount: number;
  generatedAt: string;
  generatedBy: string;
  stale: boolean;
}

// === Connector config schema ===
export interface ConfigField {
  key: string;
  label: string;
  type: "text" | "password" | "number" | "boolean";
  description?: string;
  required?: boolean;
  default?: unknown;
  placeholder?: string;
}

export interface ConnectorTypeInfo {
  type: string;
  defaultName: string;
  setupInstructions?: string;
  configSchema: ConfigField[];
}

// === Connectors ===
export interface ConnectorRecord {
  id: string;
  type: string; // "screenpipe", "gmail", "granola", etc.
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
  state: Record<string, unknown>;
  lastSyncAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

// === LLM Auto-Organizer Output ===
export interface CreatePageOp {
  title: string;
  content: string;
  tags: string[];
  aliases: string[];
}

export interface UpdatePageOp {
  slug: string;
  append?: string;
  replaceContent?: string;
}

export interface CreateAssociationOp {
  source: string; // slug or title
  target: string;
  type: AssociationType;
  weight: number;
  reason: string;
}

export interface UpdateAssociationOp {
  source: string;
  target: string;
  newWeight: number;
  reason: string;
}

export interface OrganizerOperations {
  createPages: CreatePageOp[];
  updatePages: UpdatePageOp[];
  createAssociations: CreateAssociationOp[];
  updateAssociations: UpdateAssociationOp[];
}
