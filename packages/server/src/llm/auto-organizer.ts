import type Anthropic from "@anthropic-ai/sdk";
import type {
  OrganizerOperations,
  Page,
  IngestionSource,
} from "@memory-map/shared";
import type { LLMProvider } from "./provider.js";
import type { PageStore } from "../storage/page-store.js";
import type { AssociationStore } from "../storage/association-store.js";
import type { LinkIndex } from "../engine/link-index.js";
import type { WebSocketHub } from "../ws/hub.js";
import type { SourceStore } from "../storage/source-store.js";
import type { ProfileService } from "./profile-service.js";

const INGEST_SYSTEM_PROMPT = `You are the intelligence layer of Memory Map, a personal knowledge graph.

You are processing content captured from an external source (not direct user input). Your job is to extract MEANINGFUL events, conversations, decisions, people, projects, and ideas, and organize them into the knowledge graph.

BE SELECTIVE. Most captured content is routine noise (terminal output, code editing, browsing, idle screens). Only create pages for things that genuinely matter:
- People mentioned in meetings or messages
- Decisions or commitments made
- New projects or ideas being discussed
- Important conversations or events
- Significant questions or problems raised

DO NOT create pages for:
- Routine code editing or terminal output
- App UI chrome or menus
- Repeated content already in the graph
- Trivial activity (checking email, switching tabs, etc.)

If nothing meaningful is in the content, call organize_knowledge with all empty arrays. That's a valid and important response — silence is better than noise.

When you DO create pages:
- Tag people with "person", projects with "project", topics with "concept"
- Use [[Wikilinks]] to connect entities
- Create semantic associations with weights and clear "why" reasons
- Update existing pages rather than creating duplicates

Avoid calling out the source mechanism in page content (don't write "captured via Screenpipe at..."). Just record the underlying facts.`;

const SYSTEM_PROMPT = `You are the intelligence layer of Memory Map, a personal knowledge graph.

When the user sends a message, you must:
1. RESPOND conversationally — confirm what you organized, surface related knowledge, ask clarifying questions if needed
2. CALL the organize_knowledge tool to create/update pages and associations in the knowledge graph

You have access to the user's existing knowledge graph context (provided below). Use it to:
- Avoid creating duplicate pages (check existing pages and aliases)
- Create semantic associations between new and existing content
- Update existing pages when new information modifies what's already known

RULES:
- Every person mentioned should get their own page (tagged "person")
- Every distinct project, topic, or concept gets its own page
- Use [[Wikilinks]] liberally in page content to link between pages
- Association reasons must explain WHY the connection exists, not just WHAT it is
- Weights: 0.9+ = strong direct relationship, 0.5-0.8 = moderate, 0.1-0.4 = weak/tangential
- If the user is asking a QUESTION (not providing new information), you may call the tool with empty arrays
- For questions, search the graph context and synthesize an answer from the user's own knowledge
- Keep page content concise but informative — capture the key facts and context`;

const ORGANIZE_TOOL: Anthropic.Tool = {
  name: "organize_knowledge",
  description:
    "Create or update pages and semantic associations in the knowledge graph based on the user's input.",
  input_schema: {
    type: "object" as const,
    properties: {
      create_pages: {
        type: "array",
        description: "New pages to create in the knowledge graph",
        items: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Page title (use Title Case)",
            },
            content: {
              type: "string",
              description:
                "Markdown content with [[Wikilinks]] to other pages",
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description:
                'Tags like "person", "project", "concept", "company"',
            },
            aliases: {
              type: "array",
              items: { type: "string" },
              description: "Alternative names for this page",
            },
          },
          required: ["title", "content", "tags"],
        },
      },
      update_pages: {
        type: "array",
        description: "Existing pages to update",
        items: {
          type: "object",
          properties: {
            slug: {
              type: "string",
              description: "The slug of the page to update",
            },
            append: {
              type: "string",
              description: "Content to append to the page",
            },
            replace_content: {
              type: "string",
              description: "Full replacement content (use sparingly)",
            },
          },
          required: ["slug"],
        },
      },
      create_associations: {
        type: "array",
        description: "Semantic associations to create between pages",
        items: {
          type: "object",
          properties: {
            source: {
              type: "string",
              description: "Source page slug or title",
            },
            target: {
              type: "string",
              description: "Target page slug or title",
            },
            type: {
              type: "string",
              enum: [
                "related_to",
                "informed_by",
                "contradicts",
                "alternative_to",
                "stakeholder",
                "evolved_into",
                "depends_on",
                "instance_of",
              ],
            },
            weight: {
              type: "number",
              description: "Association strength 0.0-1.0",
            },
            reason: {
              type: "string",
              description: "WHY this association exists",
            },
          },
          required: ["source", "target", "type", "weight", "reason"],
        },
      },
      update_associations: {
        type: "array",
        description: "Existing associations to update",
        items: {
          type: "object",
          properties: {
            source: { type: "string" },
            target: { type: "string" },
            new_weight: { type: "number" },
            reason: { type: "string" },
          },
          required: ["source", "target", "new_weight", "reason"],
        },
      },
    },
    required: [
      "create_pages",
      "update_pages",
      "create_associations",
      "update_associations",
    ],
  },
};

export class AutoOrganizer {
  constructor(
    private llm: LLMProvider,
    private pageStore: PageStore,
    private associationStore: AssociationStore,
    private linkIndex: LinkIndex,
    private wsHub: WebSocketHub,
    private sourceStore: SourceStore,
    private profileService: ProfileService
  ) {}

  async process(
    userMessage: string,
    chatHistory: Array<{ role: "user" | "assistant"; content: string }>
  ): Promise<{ response: string; operations: OrganizerOperations }> {
    const context = this.buildContext(userMessage);
    const system = SYSTEM_PROMPT + "\n\n" + context;

    const result = await this.llm.chat({
      system,
      messages: chatHistory,
      tools: [ORGANIZE_TOOL],
      maxTokens: 4096,
    });

    const operations = this.parseOperations(result.toolUse);
    await this.executeOperations(operations, null);
    return { response: result.text, operations };
  }

  /**
   * Ingest content from a connector (Screenpipe, Gmail, etc.) with full
   * provenance tracking. Records the source memory and tags every page
   * and association produced with the source ID so the user can later
   * see exactly where each piece of knowledge came from.
   */
  async ingest(input: IngestionSource): Promise<OrganizerOperations> {
    // Record the source memory first so we have an ID to tag operations with
    const source = this.sourceStore.recordSource(input);

    const context = this.buildContext(input.content.slice(0, 2000));

    const system = `${INGEST_SYSTEM_PROMPT}

SOURCE: ${input.sourceLabel}

${context}`;

    const result = await this.llm.chat({
      system,
      messages: [
        {
          role: "user",
          content: `Here is captured content from ${input.sourceLabel}. Extract anything meaningful and organize it into the knowledge graph. Skip routine/trivial content. Be selective — only create pages for things that genuinely matter.\n\n---\n\n${input.content}`,
        },
      ],
      tools: [ORGANIZE_TOOL],
      maxTokens: 4096,
    });

    const operations = this.parseOperations(result.toolUse);
    await this.executeOperations(operations, source.id);
    return operations;
  }

  private buildContext(userMessage: string): string {
    const allTitles = this.pageStore.allTitles();

    // Search for relevant pages
    let relevantPages: Page[] = [];
    try {
      // FTS5 needs special quoting for queries with special chars
      const safeQuery = userMessage.replace(/[^\w\s]/g, " ").trim();
      if (safeQuery) {
        relevantPages = this.pageStore.search(safeQuery, 10);
      }
    } catch {
      // FTS query failed, that's ok
    }

    // Get associations between found pages
    const pageIds = relevantPages.map((p) => p.frontmatter.id);
    const associations = this.associationStore.getBetween(pageIds);

    let context = "";

    if (relevantPages.length > 0) {
      context += "EXISTING PAGES (relevant to this message):\n";
      for (const p of relevantPages) {
        context += `- ${p.frontmatter.title} (slug: ${p.slug}): ${p.content.slice(0, 500)}\n`;
      }
      context += "\n";
    }

    if (associations.length > 0) {
      context += "EXISTING ASSOCIATIONS:\n";
      for (const a of associations) {
        context += `- [${a.type}, weight: ${a.weight}]: ${a.reason}\n`;
      }
      context += "\n";
    }

    if (allTitles.length > 0) {
      context += `ALL PAGE TITLES (for duplicate detection):\n${allTitles.join(", ")}\n`;
    } else {
      context +=
        "The knowledge graph is currently empty. This is the user's first interaction.\n";
    }

    return context;
  }

  private parseOperations(
    toolUse: Array<{ name: string; input: unknown }>
  ): OrganizerOperations {
    const empty: OrganizerOperations = {
      createPages: [],
      updatePages: [],
      createAssociations: [],
      updateAssociations: [],
    };

    const call = toolUse.find((t) => t.name === "organize_knowledge");
    if (!call) return empty;

    const input = call.input as any;

    return {
      createPages: (input.create_pages ?? []).map((p: any) => ({
        title: p.title,
        content: p.content,
        tags: p.tags ?? [],
        aliases: p.aliases ?? [],
      })),
      updatePages: (input.update_pages ?? []).map((p: any) => ({
        slug: p.slug,
        append: p.append,
        replaceContent: p.replace_content,
      })),
      createAssociations: (input.create_associations ?? []).map((a: any) => ({
        source: a.source,
        target: a.target,
        type: a.type,
        weight: a.weight,
        reason: a.reason,
      })),
      updateAssociations: (input.update_associations ?? []).map((a: any) => ({
        source: a.source,
        target: a.target,
        newWeight: a.new_weight,
        reason: a.reason,
      })),
    };
  }

  private async executeOperations(
    ops: OrganizerOperations,
    sourceId: string | null
  ): Promise<void> {
    const touchedPageIds = new Set<string>();

    // Create pages first (so associations can reference them)
    for (const op of ops.createPages) {
      const page = this.pageStore.create(op);
      this.linkIndex.updateForPage(page.frontmatter.id, page.links);
      this.wsHub.broadcast({ type: "page:created", page });
      if (sourceId) {
        this.sourceStore.linkPageToSource(page.frontmatter.id, sourceId, "created");
      }
      touchedPageIds.add(page.frontmatter.id);
    }

    for (const op of ops.updatePages) {
      const page = this.pageStore.update(op);
      if (page) {
        this.linkIndex.updateForPage(page.frontmatter.id, page.links);
        this.wsHub.broadcast({ type: "page:updated", page });
        if (sourceId) {
          this.sourceStore.linkPageToSource(page.frontmatter.id, sourceId, "updated");
        }
        touchedPageIds.add(page.frontmatter.id);
      }
    }

    for (const op of ops.createAssociations) {
      const assoc = this.associationStore.create(op, this.llm.modelId);
      if (assoc) {
        this.wsHub.broadcast({ type: "association:created", association: assoc });
        if (sourceId) {
          this.sourceStore.linkAssociationToSource(assoc.id, sourceId);
        }
        touchedPageIds.add(assoc.sourceId);
        touchedPageIds.add(assoc.targetId);
      }
    }

    for (const op of ops.updateAssociations) {
      const assoc = this.associationStore.update(op, this.llm.modelId);
      if (assoc) {
        this.wsHub.broadcast({ type: "association:updated", association: assoc });
        if (sourceId) {
          this.sourceStore.linkAssociationToSource(assoc.id, sourceId);
        }
        touchedPageIds.add(assoc.sourceId);
        touchedPageIds.add(assoc.targetId);
      }
    }

    // Mark profiles stale for any page touched by this batch
    for (const pageId of touchedPageIds) {
      this.profileService.markStale(pageId);
    }
  }
}

