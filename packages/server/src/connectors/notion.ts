import type { Connector, SyncResult, IngestFn } from "./types.js";
import type { ConnectorRecord, ConfigField } from "@memory-map/shared";

interface NotionRichText {
  type?: string;
  plain_text: string;
  href?: string | null;
  text?: { content: string };
}

interface NotionBlock {
  id: string;
  object: "block";
  type: string;
  has_children: boolean;
  created_time: string;
  last_edited_time: string;
  // Block-type-specific payloads (we read whichever matches `type`)
  paragraph?: { rich_text: NotionRichText[] };
  heading_1?: { rich_text: NotionRichText[] };
  heading_2?: { rich_text: NotionRichText[] };
  heading_3?: { rich_text: NotionRichText[] };
  bulleted_list_item?: { rich_text: NotionRichText[] };
  numbered_list_item?: { rich_text: NotionRichText[] };
  to_do?: { rich_text: NotionRichText[]; checked: boolean };
  toggle?: { rich_text: NotionRichText[] };
  code?: { rich_text: NotionRichText[]; language: string };
  quote?: { rich_text: NotionRichText[] };
  callout?: { rich_text: NotionRichText[] };
  child_page?: { title: string };
  child_database?: { title: string };
  bookmark?: { url: string };
  embed?: { url: string };
  link_preview?: { url: string };
  image?: { caption?: NotionRichText[] };
  // Children fetched separately via /v1/blocks/:id/children
  children?: NotionBlock[];
}

interface NotionPage {
  id: string;
  object: "page";
  created_time: string;
  last_edited_time: string;
  archived: boolean;
  url: string;
  parent: { type: string; database_id?: string; page_id?: string };
  properties: Record<string, any>;
}

interface NotionSearchResponse {
  object: "list";
  results: NotionPage[];
  has_more: boolean;
  next_cursor: string | null;
}

interface NotionBlockChildrenResponse {
  object: "list";
  results: NotionBlock[];
  has_more: boolean;
  next_cursor: string | null;
}

interface NotionState {
  lastEditedTime?: string;
  ingestedIds?: string[];
  totalIngested?: number;
  [key: string]: unknown;
}

interface NotionConfig {
  apiKey: string;
  pollSeconds: number;
  maxPagesPerSync: number;
  ingestHistorical: boolean;
  maxBlockDepth: number;
}

const DEFAULT_CONFIG: NotionConfig = {
  apiKey: "",
  pollSeconds: 1800, // 30 minutes
  maxPagesPerSync: 25,
  ingestHistorical: true,
  maxBlockDepth: 3,
};

const NOTION_CONFIG_SCHEMA: ConfigField[] = [
  {
    key: "apiKey",
    label: "Integration token",
    type: "password",
    required: true,
    description:
      "Your Notion internal integration secret. Create one at notion.so/profile/integrations.",
    placeholder: "secret_…",
  },
  {
    key: "maxPagesPerSync",
    label: "Max pages per sync",
    type: "number",
    default: 25,
    description: "Be polite to Notion's API. Higher values take longer.",
  },
  {
    key: "pollSeconds",
    label: "Poll interval (seconds)",
    type: "number",
    default: 1800,
  },
  {
    key: "ingestHistorical",
    label: "Ingest existing pages on first sync",
    type: "boolean",
    default: true,
  },
];

const NOTION_SETUP_INSTRUCTIONS = `**Setup steps:**

1. Visit [notion.so/profile/integrations](https://www.notion.so/profile/integrations) and create a new internal integration. Name it whatever you like (e.g. "Memory Map").
2. Copy the **Internal Integration Secret** (starts with \`secret_\` or \`ntn_\`).
3. Open any Notion page or database you want to import. Click the "..." menu → **Connections** → search for your integration and add it.
4. Repeat step 3 for every top-level page or database you want to share. The integration only sees what you explicitly share with it.
5. Paste the integration secret in the field below, save, then click **Sync now**.`;

export class NotionConnector implements Connector {
  readonly type = "notion";
  readonly defaultName = "Notion";
  readonly defaultConfig = DEFAULT_CONFIG as unknown as Record<string, unknown>;
  readonly defaultPollSeconds = DEFAULT_CONFIG.pollSeconds;
  readonly configSchema = NOTION_CONFIG_SCHEMA;
  readonly setupInstructions = NOTION_SETUP_INSTRUCTIONS;

  async sync(record: ConnectorRecord, ingestFn: IngestFn): Promise<SyncResult> {
    const config = { ...DEFAULT_CONFIG, ...(record.config as Partial<NotionConfig>) };
    const state = record.state as NotionState;

    if (!config.apiKey || config.apiKey.trim() === "") {
      throw new Error(
        "Notion API key not configured. Add an integration token in the connector settings."
      );
    }

    const isFirstSync = !state.lastEditedTime;

    if (isFirstSync && !config.ingestHistorical) {
      // Skip historical: just record the latest edit time as the cursor
      const latest = await this.searchPages(config.apiKey, 1);
      const cursor =
        latest.length > 0 ? latest[0].last_edited_time : new Date().toISOString();
      return {
        itemsFetched: 0,
        itemsIngested: 0,
        message: `First sync skipped historical content. Will ingest pages edited after ${cursor}.`,
        newState: { ...state, lastEditedTime: cursor, ingestedIds: [] },
      };
    }

    // Fetch pages updated since cursor (or all pages on first ingestion)
    const sinceCursor = state.lastEditedTime;
    const pages = await this.fetchPagesSince(
      config.apiKey,
      sinceCursor,
      config.maxPagesPerSync
    );

    if (pages.length === 0) {
      return {
        itemsFetched: 0,
        itemsIngested: 0,
        message: "No new or updated pages",
        newState: state,
      };
    }

    let ingested = 0;
    let newestEdit = sinceCursor ?? "1970-01-01T00:00:00Z";
    const ingestedIds = new Set(state.ingestedIds ?? []);

    for (const page of pages) {
      try {
        const title = this.extractTitle(page);
        const blocks = await this.fetchAllBlocks(config.apiKey, page.id, 0, config.maxBlockDepth);
        const body = this.blocksToMarkdown(blocks).trim();

        // Skip pages with no meaningful body
        if (body.length < 10 && title.length < 3) {
          continue;
        }

        const content = `# ${title}\n\n${body || "(empty page)"}`;

        await ingestFn({
          externalSource: "notion",
          externalId: page.id,
          content,
          sourceLabel: `Notion / ${title}`,
          capturedAt: page.last_edited_time,
          tags: ["notion"],
        });

        ingested++;
        ingestedIds.add(page.id);
        if (page.last_edited_time > newestEdit) {
          newestEdit = page.last_edited_time;
        }

        // Rate-limit politely (Notion allows ~3 req/sec)
        await this.sleep(400);
      } catch (err) {
        console.error(`[notion] page ${page.id} failed:`, err);
        // Don't update cursor on failure so we retry next sync
        break;
      }
    }

    return {
      itemsFetched: pages.length,
      itemsIngested: ingested,
      message: `Ingested ${ingested} of ${pages.length} pages`,
      newState: {
        ...state,
        lastEditedTime: newestEdit,
        ingestedIds: Array.from(ingestedIds).slice(-500), // cap memory
        totalIngested: (state.totalIngested ?? 0) + ingested,
      },
    };
  }

  // ─── Notion API helpers ──────────────────────────────────────

  private headers(apiKey: string): Record<string, string> {
    return {
      Authorization: `Bearer ${apiKey}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    };
  }

  /** Search for pages, sorted by last_edited_time descending */
  private async searchPages(apiKey: string, pageSize: number): Promise<NotionPage[]> {
    const res = await fetch("https://api.notion.com/v1/search", {
      method: "POST",
      headers: this.headers(apiKey),
      body: JSON.stringify({
        filter: { property: "object", value: "page" },
        sort: { direction: "descending", timestamp: "last_edited_time" },
        page_size: pageSize,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Notion search failed: ${res.status} ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as NotionSearchResponse;
    return json.results.filter((p) => !p.archived);
  }

  /**
   * Fetch all pages updated after the cursor, paging through search results
   * sorted by last_edited_time descending until we hit something older than
   * the cursor or hit maxPages.
   */
  private async fetchPagesSince(
    apiKey: string,
    sinceCursor: string | undefined,
    maxPages: number
  ): Promise<NotionPage[]> {
    const collected: NotionPage[] = [];
    let nextCursor: string | undefined;

    while (collected.length < maxPages) {
      const body: any = {
        filter: { property: "object", value: "page" },
        sort: { direction: "descending", timestamp: "last_edited_time" },
        page_size: Math.min(50, maxPages - collected.length + 5),
      };
      if (nextCursor) body.start_cursor = nextCursor;

      const res = await fetch("https://api.notion.com/v1/search", {
        method: "POST",
        headers: this.headers(apiKey),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Notion search failed: ${res.status} ${text.slice(0, 200)}`);
      }
      const json = (await res.json()) as NotionSearchResponse;

      for (const page of json.results) {
        if (page.archived) continue;
        if (sinceCursor && page.last_edited_time <= sinceCursor) {
          // Sorted descending; everything after this is older
          return collected;
        }
        collected.push(page);
        if (collected.length >= maxPages) return collected;
      }

      if (!json.has_more || !json.next_cursor) break;
      nextCursor = json.next_cursor;
    }

    // Reverse so we ingest oldest-first within the batch (more natural ordering)
    return collected.reverse();
  }

  /** Fetch all blocks for a page (or block), recursively */
  private async fetchAllBlocks(
    apiKey: string,
    blockId: string,
    depth: number,
    maxDepth: number
  ): Promise<NotionBlock[]> {
    if (depth >= maxDepth) return [];

    const blocks: NotionBlock[] = [];
    let cursor: string | undefined;

    do {
      const url = new URL(`https://api.notion.com/v1/blocks/${blockId}/children`);
      url.searchParams.set("page_size", "100");
      if (cursor) url.searchParams.set("start_cursor", cursor);

      const res = await fetch(url.toString(), { headers: this.headers(apiKey) });
      if (!res.ok) {
        // Don't fail the whole sync — just skip blocks we can't read
        console.warn(`[notion] block ${blockId} failed: ${res.status}`);
        return blocks;
      }
      const json = (await res.json()) as NotionBlockChildrenResponse;
      blocks.push(...json.results);
      cursor = json.has_more && json.next_cursor ? json.next_cursor : undefined;
    } while (cursor);

    // Recursively fetch children for blocks that have them
    for (const block of blocks) {
      if (block.has_children && depth + 1 < maxDepth) {
        block.children = await this.fetchAllBlocks(apiKey, block.id, depth + 1, maxDepth);
        await this.sleep(200);
      }
    }

    return blocks;
  }

  /** Extract a page title from its properties */
  private extractTitle(page: NotionPage): string {
    for (const prop of Object.values(page.properties ?? {}) as any[]) {
      if (prop?.type === "title" && Array.isArray(prop.title)) {
        const text = prop.title.map((t: NotionRichText) => t.plain_text).join("");
        if (text) return text;
      }
    }
    return "Untitled";
  }

  /** Convert a Notion block tree to markdown */
  private blocksToMarkdown(blocks: NotionBlock[], depth: number = 0): string {
    const indent = "  ".repeat(depth);
    let out = "";

    const richText = (rt: NotionRichText[] | undefined): string =>
      (rt ?? []).map((t) => t.plain_text).join("");

    for (const block of blocks) {
      let line = "";
      switch (block.type) {
        case "paragraph": {
          const text = richText(block.paragraph?.rich_text);
          if (text) line = `${indent}${text}\n\n`;
          break;
        }
        case "heading_1":
          line = `${indent}# ${richText(block.heading_1?.rich_text)}\n\n`;
          break;
        case "heading_2":
          line = `${indent}## ${richText(block.heading_2?.rich_text)}\n\n`;
          break;
        case "heading_3":
          line = `${indent}### ${richText(block.heading_3?.rich_text)}\n\n`;
          break;
        case "bulleted_list_item":
          line = `${indent}- ${richText(block.bulleted_list_item?.rich_text)}\n`;
          break;
        case "numbered_list_item":
          line = `${indent}1. ${richText(block.numbered_list_item?.rich_text)}\n`;
          break;
        case "to_do": {
          const checked = block.to_do?.checked ? "x" : " ";
          line = `${indent}- [${checked}] ${richText(block.to_do?.rich_text)}\n`;
          break;
        }
        case "toggle":
          line = `${indent}▸ ${richText(block.toggle?.rich_text)}\n`;
          break;
        case "code":
          line = `${indent}\`\`\`${block.code?.language ?? ""}\n${richText(block.code?.rich_text)}\n\`\`\`\n\n`;
          break;
        case "quote":
          line = `${indent}> ${richText(block.quote?.rich_text)}\n\n`;
          break;
        case "callout":
          line = `${indent}> 💡 ${richText(block.callout?.rich_text)}\n\n`;
          break;
        case "divider":
          line = `${indent}---\n\n`;
          break;
        case "child_page":
          line = `${indent}[Sub-page: ${block.child_page?.title ?? "Untitled"}]\n`;
          break;
        case "child_database":
          line = `${indent}[Database: ${block.child_database?.title ?? "Untitled"}]\n`;
          break;
        case "bookmark":
          if (block.bookmark?.url) line = `${indent}[Bookmark: ${block.bookmark.url}]\n`;
          break;
        case "embed":
          if (block.embed?.url) line = `${indent}[Embed: ${block.embed.url}]\n`;
          break;
        case "link_preview":
          if (block.link_preview?.url) line = `${indent}[Link: ${block.link_preview.url}]\n`;
          break;
        case "image": {
          const cap = richText(block.image?.caption);
          line = `${indent}[Image${cap ? `: ${cap}` : ""}]\n`;
          break;
        }
        // Unknown / unhandled — drop silently
      }

      out += line;

      // Recurse into children
      if (block.children && block.children.length > 0) {
        out += this.blocksToMarkdown(block.children, depth + 1);
      }
    }

    return out;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
