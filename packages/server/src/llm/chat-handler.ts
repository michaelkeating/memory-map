import type Anthropic from "@anthropic-ai/sdk";
import { ulid } from "ulid";
import type { LLMProvider, LLMMessage } from "./provider.js";
import type { PageStore } from "../storage/page-store.js";
import type { AssociationStore } from "../storage/association-store.js";
import type { LinkIndex } from "../engine/link-index.js";
import type { WebSocketHub } from "../ws/hub.js";
import type { ProfileService } from "./profile-service.js";

const SYSTEM_PROMPT = `You are the conversational interface to **Memory Map**, the user's personal knowledge graph. Memory Map turns captured observations (from Screenpipe, Notion, Google Drive, chat input) into pages and connections.

Your job is to help the user **search**, **read**, **add**, and **modify** memories in their graph. You have a set of tools to do this. Use them iteratively: search first, read the results, then act.

GENERAL APPROACH:

- For **search/lookup questions** ("Who is Marcus?", "What did I write about K8s?"), use search_pages, then optionally get_page on the most relevant hit, then synthesize a clear answer that cites specific pages by their title.
- For **add requests** ("Add a note that...", "Remember that..."), first search to see if a related page already exists. If it does, update_page with appended content. If not, create_page.
- For **modify requests** ("Change the page about X to say...", "Add Y to the K8s page"), search → get_page → update_page.
- For **delete requests** ("Forget about X", "Remove the page on Y"), search → confirm with the user before delete_page.
- For **navigation requests** ("Show me the project pages", "What are people I know?"), use search or list_pages_by_tag and reply with a quick summary.

WHEN YOU FIND OR REFERENCE A PAGE:
Always include the page title in [[Wikilink]] form in your response. The user's chat client renders these as clickable links AND uses them to focus the graph on those pages. So always link the relevant pages.

TONE:
- Conversational, direct, and brief. Don't over-explain.
- When you've completed an action, confirm what you did in one short sentence.
- For questions, give the answer first, then optional context.
- Don't dump JSON. Don't list every tool you called. Just give the human-readable result.

DO NOT:
- Make things up. If you don't find a page, say so.
- Modify pages without being asked.
- Delete pages without explicit confirmation from the user.
- Spam tool calls. Search once, then act.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_pages",
    description:
      "Full-text search across all pages in the knowledge graph. Returns matching pages with title, slug, tags, and a content excerpt. Use this first when the user asks about a topic or person.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query (free text).",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default 10).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_page",
    description:
      "Fetch the full content of a specific page by its slug or exact title. Use this after search to read a page's full body before answering or editing.",
    input_schema: {
      type: "object" as const,
      properties: {
        identifier: {
          type: "string",
          description: "The page's slug or exact title.",
        },
      },
      required: ["identifier"],
    },
  },
  {
    name: "list_recent_pages",
    description:
      "List the most recently modified pages in the graph. Useful for 'what have I been thinking about lately' or similar questions.",
    input_schema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number",
          description: "Number of pages to return (default 20).",
        },
      },
    },
  },
  {
    name: "list_pages_by_tag",
    description:
      "List all pages tagged with a specific tag (e.g. 'person', 'project', 'company').",
    input_schema: {
      type: "object" as const,
      properties: {
        tag: { type: "string", description: "The tag to filter by." },
      },
      required: ["tag"],
    },
  },
  {
    name: "create_page",
    description:
      "Create a new page in the graph. Use [[Wikilinks]] in the content to connect to other pages.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string" },
        content: {
          type: "string",
          description: "Markdown body. Use [[Wikilinks]] to connect to other pages.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags like 'person', 'project', 'concept', 'company'.",
        },
      },
      required: ["title", "content"],
    },
  },
  {
    name: "update_page",
    description:
      "Update an existing page. Provide either `append` (to add content to the end) or `replace_content` (to replace the body entirely). Optionally update title or tags.",
    input_schema: {
      type: "object" as const,
      properties: {
        identifier: {
          type: "string",
          description: "The page's slug or exact title.",
        },
        append: {
          type: "string",
          description: "Content to append to the existing body. Newlines are added automatically.",
        },
        replace_content: {
          type: "string",
          description: "Full replacement content (use sparingly).",
        },
        title: { type: "string", description: "New title (optional)." },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "New full tag list (replaces existing tags).",
        },
      },
      required: ["identifier"],
    },
  },
  {
    name: "delete_page",
    description:
      "Delete a page from the graph. Only call this after the user explicitly confirms they want it gone.",
    input_schema: {
      type: "object" as const,
      properties: {
        identifier: {
          type: "string",
          description: "The page's slug or exact title.",
        },
      },
      required: ["identifier"],
    },
  },
  {
    name: "create_association",
    description:
      "Create a semantic association between two existing pages. Use this to capture relationships the explicit wikilinks don't.",
    input_schema: {
      type: "object" as const,
      properties: {
        source: { type: "string", description: "Source page slug or title." },
        target: { type: "string", description: "Target page slug or title." },
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
        weight: { type: "number", description: "0.0–1.0" },
        reason: { type: "string", description: "Why this connection exists." },
      },
      required: ["source", "target", "type", "weight", "reason"],
    },
  },
  {
    name: "get_page_neighbors",
    description:
      "Get pages connected to the given page via wikilinks or semantic associations. Useful for 'what's related to X' or 'who works on this project'.",
    input_schema: {
      type: "object" as const,
      properties: {
        identifier: { type: "string", description: "Page slug or title." },
      },
      required: ["identifier"],
    },
  },
];

export interface ChatHandlerResult {
  response: string;
  /** Page IDs the chat surfaced — used to focus the graph */
  focusedPageIds: string[];
  /** Page IDs that were created or updated during this turn */
  touchedPageIds: string[];
}

export class ChatHandler {
  constructor(
    private llm: LLMProvider,
    private pageStore: PageStore,
    private associationStore: AssociationStore,
    private linkIndex: LinkIndex,
    private wsHub: WebSocketHub,
    private profileService: ProfileService
  ) {}

  async chat(
    userMessage: string,
    history: Array<{ role: "user" | "assistant"; content: string }>
  ): Promise<ChatHandlerResult> {
    const messages: LLMMessage[] = history.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    messages.push({ role: "user", content: userMessage });

    // Track which pages the LLM looked up or touched — these become the
    // focused set the frontend uses to highlight in the graph.
    const touchedPageIds = new Set<string>();
    const surfacedPageIds = new Set<string>();

    const MAX_TURNS = 8;
    let lastText = "";

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const result = await this.llm.chat({
        system: SYSTEM_PROMPT,
        messages,
        tools: TOOLS,
        maxTokens: 4096,
      });

      lastText = result.text;

      if (result.stopReason !== "tool_use" || result.toolUse.length === 0) {
        // No more tool calls — we're done
        break;
      }

      // Append the assistant's tool-call message verbatim
      messages.push({
        role: "assistant",
        content: result.contentBlocks as any,
      });

      // Execute each tool call and collect results
      const toolResults: any[] = [];
      for (const toolCall of result.toolUse) {
        const { result: toolResult, surfacedIds, touchedIds } = await this.executeTool(
          toolCall.name,
          toolCall.input
        );
        for (const id of surfacedIds) surfacedPageIds.add(id);
        for (const id of touchedIds) touchedPageIds.add(id);

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolCall.id,
          content: JSON.stringify(toolResult),
        });
      }

      // Append tool results as a user message
      messages.push({
        role: "user",
        content: toolResults,
      });
    }

    // Extract focus pages mentioned in the final response too. Look for
    // [[Wikilinks]] in the assistant's text and resolve them.
    const linkedFromText = this.extractFocusFromText(lastText);
    for (const id of linkedFromText) surfacedPageIds.add(id);

    // Mark profiles stale for any pages we touched
    for (const id of touchedPageIds) {
      this.profileService.markStale(id);
    }

    return {
      response: lastText,
      focusedPageIds: [...surfacedPageIds],
      touchedPageIds: [...touchedPageIds],
    };
  }

  // ─── Tool dispatch ──────────────────────────────────────────

  private async executeTool(
    name: string,
    rawInput: unknown
  ): Promise<{
    result: unknown;
    surfacedIds: string[];
    touchedIds: string[];
  }> {
    const input = rawInput as Record<string, any>;

    switch (name) {
      case "search_pages": {
        const query = String(input.query ?? "").trim();
        const limit = Number(input.limit ?? 10);
        if (!query) return { result: { matches: [] }, surfacedIds: [], touchedIds: [] };
        const results = this.pageStore.search(query, limit);
        const matches = results.map((p) => ({
          id: p.frontmatter.id,
          slug: p.slug,
          title: p.frontmatter.title,
          tags: p.frontmatter.tags,
          excerpt: p.content.slice(0, 300),
        }));
        return {
          result: { matches, count: matches.length },
          surfacedIds: results.map((p) => p.frontmatter.id),
          touchedIds: [],
        };
      }

      case "get_page": {
        const id = this.resolveIdentifier(String(input.identifier ?? ""));
        if (!id) return { result: { error: "Page not found" }, surfacedIds: [], touchedIds: [] };
        const page = this.pageStore.getById(id);
        if (!page) return { result: { error: "Page not found" }, surfacedIds: [], touchedIds: [] };
        const associations = this.associationStore.getForPage(id);
        const backlinks = this.linkIndex.getBacklinks(id).map((bid) => {
          const bp = this.pageStore.getById(bid);
          return bp ? { id: bid, title: bp.frontmatter.title } : null;
        }).filter(Boolean);
        return {
          result: {
            id: page.frontmatter.id,
            slug: page.slug,
            title: page.frontmatter.title,
            tags: page.frontmatter.tags,
            content: page.content,
            modified: page.frontmatter.modified,
            backlinks,
            associations: associations.map((a) => ({
              type: a.type,
              weight: a.weight,
              reason: a.reason,
              direction: a.sourceId === id ? "outgoing" : "incoming",
              other: a.sourceId === id ? a.targetId : a.sourceId,
            })),
          },
          surfacedIds: [id],
          touchedIds: [],
        };
      }

      case "list_recent_pages": {
        const limit = Number(input.limit ?? 20);
        const all = this.pageStore.listAll().slice(0, limit);
        return {
          result: { pages: all },
          surfacedIds: all.map((p) => p.id),
          touchedIds: [],
        };
      }

      case "list_pages_by_tag": {
        const tag = String(input.tag ?? "").trim();
        if (!tag) return { result: { pages: [] }, surfacedIds: [], touchedIds: [] };
        const all = this.pageStore.listAll().filter((p) => p.tags.includes(tag));
        return {
          result: { pages: all, count: all.length },
          surfacedIds: all.map((p) => p.id),
          touchedIds: [],
        };
      }

      case "create_page": {
        const title = String(input.title ?? "").trim();
        const content = String(input.content ?? "");
        const tags = Array.isArray(input.tags) ? input.tags.map(String) : [];
        if (!title) return { result: { error: "Title required" }, surfacedIds: [], touchedIds: [] };
        const page = this.pageStore.create(
          { title, content, tags, aliases: [] },
          "chat"
        );
        this.linkIndex.updateForPage(page.frontmatter.id, page.links);
        this.wsHub.broadcast({ type: "page:created", page });
        return {
          result: {
            ok: true,
            id: page.frontmatter.id,
            slug: page.slug,
            title: page.frontmatter.title,
          },
          surfacedIds: [page.frontmatter.id],
          touchedIds: [page.frontmatter.id],
        };
      }

      case "update_page": {
        const id = this.resolveIdentifier(String(input.identifier ?? ""));
        if (!id) return { result: { error: "Page not found" }, surfacedIds: [], touchedIds: [] };

        // Build update edits
        const edits: { title?: string; content?: string; tags?: string[] } = {};
        if (input.title) edits.title = String(input.title);
        if (Array.isArray(input.tags)) edits.tags = input.tags.map(String);

        if (input.replace_content != null) {
          edits.content = String(input.replace_content);
        } else if (input.append) {
          const existing = this.pageStore.getById(id);
          if (existing) {
            edits.content = existing.content.trimEnd() + "\n\n" + String(input.append);
          }
        }

        const page = this.pageStore.updateById(id, edits);
        if (!page) return { result: { error: "Update failed" }, surfacedIds: [], touchedIds: [] };
        this.linkIndex.updateForPage(id, page.links);
        this.wsHub.broadcast({ type: "page:updated", page });
        return {
          result: {
            ok: true,
            id,
            slug: page.slug,
            title: page.frontmatter.title,
          },
          surfacedIds: [id],
          touchedIds: [id],
        };
      }

      case "delete_page": {
        const id = this.resolveIdentifier(String(input.identifier ?? ""));
        if (!id) return { result: { error: "Page not found" }, surfacedIds: [], touchedIds: [] };
        const ok = this.pageStore.delete(id);
        if (ok) this.wsHub.broadcast({ type: "page:deleted", pageId: id });
        return { result: { ok }, surfacedIds: [], touchedIds: [] };
      }

      case "create_association": {
        const assoc = this.associationStore.create(
          {
            source: String(input.source),
            target: String(input.target),
            type: input.type,
            weight: Number(input.weight),
            reason: String(input.reason),
          },
          this.llm.modelId
        );
        if (!assoc) {
          return {
            result: { error: "Could not create association — check source/target slugs" },
            surfacedIds: [],
            touchedIds: [],
          };
        }
        this.wsHub.broadcast({ type: "association:created", association: assoc });
        return {
          result: { ok: true, id: assoc.id },
          surfacedIds: [assoc.sourceId, assoc.targetId],
          touchedIds: [assoc.sourceId, assoc.targetId],
        };
      }

      case "get_page_neighbors": {
        const id = this.resolveIdentifier(String(input.identifier ?? ""));
        if (!id) return { result: { error: "Page not found" }, surfacedIds: [], touchedIds: [] };
        const forward = this.linkIndex.getForwardLinks(id);
        const backward = this.linkIndex.getBacklinks(id);
        const associations = this.associationStore.getForPage(id);
        const neighborIds = new Set([
          ...forward,
          ...backward,
          ...associations.map((a) => (a.sourceId === id ? a.targetId : a.sourceId)),
        ]);
        const neighbors = [...neighborIds]
          .map((nid) => this.pageStore.getById(nid))
          .filter(Boolean)
          .map((p) => ({
            id: p!.frontmatter.id,
            title: p!.frontmatter.title,
            tags: p!.frontmatter.tags,
          }));
        return {
          result: { neighbors, count: neighbors.length },
          surfacedIds: [id, ...[...neighborIds]],
          touchedIds: [],
        };
      }

      default:
        return {
          result: { error: `Unknown tool: ${name}` },
          surfacedIds: [],
          touchedIds: [],
        };
    }
  }

  // ─── Helpers ────────────────────────────────────────────────

  /** Resolve a slug or title to a page ID */
  private resolveIdentifier(identifier: string): string | null {
    if (!identifier) return null;
    return this.pageStore.resolveToId(identifier);
  }

  /** Extract page IDs referenced as [[Wikilinks]] in the text */
  private extractFocusFromText(text: string): string[] {
    const ids: string[] = [];
    const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const id = this.pageStore.resolveToId(match[1].trim());
      if (id) ids.push(id);
    }
    return ids;
  }
}

// We need a synthetic ULID import to keep the file self-contained
void ulid;
