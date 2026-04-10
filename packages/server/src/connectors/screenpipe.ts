import type { Connector, SyncResult, IngestFn } from "./types.js";
import type { ConnectorRecord, ConfigField } from "@memory-map/shared";

interface ScreenpipeMemory {
  id: number;
  content: string;
  source: string;
  tags: string[];
  importance: number;
  frame_id: number | null;
  created_at: string;
  updated_at: string;
}

interface ScreenpipeMemoryListResponse {
  data: ScreenpipeMemory[];
  pagination: { limit: number; offset: number; total: number };
}

interface ScreenpipeState {
  lastMemoryId?: number; // highest memory ID we've ingested
  totalIngested?: number;
  [key: string]: unknown;
}

interface ScreenpipeConfig {
  baseUrl: string;
  pollSeconds: number;
  minImportance: number; // skip memories below this
  maxPerSync: number;
  ingestHistorical: boolean; // on first sync, pull all existing memories
  sourceFilter: string; // optional: only ingest memories with this source
  tagFilter: string; // optional: only ingest memories with this tag
}

const DEFAULT_CONFIG: ScreenpipeConfig = {
  baseUrl: "http://localhost:3030",
  pollSeconds: 600, // 10 minutes
  minImportance: 0.5,
  maxPerSync: 50,
  ingestHistorical: true,
  sourceFilter: "",
  tagFilter: "",
};

const SCREENPIPE_CONFIG_SCHEMA: ConfigField[] = [
  {
    key: "baseUrl",
    label: "Screenpipe API URL",
    type: "text",
    default: "http://localhost:3030",
    description: "Where the Screenpipe API is running. Default is fine for local installs.",
  },
  {
    key: "sourceFilter",
    label: "Source filter (optional)",
    type: "text",
    description:
      'Only auto-import memories with this exact source (e.g. "digital-clone", "manual"). Leave blank to import from all sources.',
    placeholder: "digital-clone",
  },
  {
    key: "tagFilter",
    label: "Tag filter (optional)",
    type: "text",
    description:
      'Only auto-import memories that have this tag (e.g. "memorymap", "important"). Leave blank to ignore tags.',
    placeholder: "memorymap",
  },
  {
    key: "minImportance",
    label: "Min importance",
    type: "number",
    default: 0.5,
    description: "Skip memories with importance below this threshold (0.0–1.0).",
  },
  {
    key: "pollSeconds",
    label: "Poll interval (seconds)",
    type: "number",
    default: 600,
  },
  {
    key: "ingestHistorical",
    label: "Ingest historical memories on first sync",
    type: "boolean",
    default: true,
  },
];

export class ScreenpipeConnector implements Connector {
  readonly type = "screenpipe";
  readonly defaultName = "Screenpipe Memories";
  readonly defaultConfig = DEFAULT_CONFIG as unknown as Record<string, unknown>;
  readonly defaultPollSeconds = DEFAULT_CONFIG.pollSeconds;
  readonly configSchema = SCREENPIPE_CONFIG_SCHEMA;
  readonly setupInstructions =
    "Make sure Screenpipe is running locally. The default URL works for standard installs.";

  async sync(record: ConnectorRecord, ingestFn: IngestFn): Promise<SyncResult> {
    const config = { ...DEFAULT_CONFIG, ...(record.config as Partial<ScreenpipeConfig>) };
    const state = record.state as ScreenpipeState;

    // Fetch memories ordered by ID ascending so we can track a cursor
    const memories = await this.fetchMemories(config, state.lastMemoryId);

    // First sync: optionally skip historical
    const isFirstSync = state.lastMemoryId === undefined;
    if (isFirstSync && !config.ingestHistorical) {
      const highestId = memories.length > 0
        ? Math.max(...memories.map((m) => m.id))
        : 0;
      return {
        itemsFetched: memories.length,
        itemsIngested: 0,
        message: `First sync: skipped ${memories.length} historical memories (ingestHistorical=false). Will ingest new memories from now.`,
        newState: { ...state, lastMemoryId: highestId },
      };
    }

    if (memories.length === 0) {
      return {
        itemsFetched: 0,
        itemsIngested: 0,
        message: "No new memories",
        newState: state,
      };
    }

    // Filter by importance
    const filtered = memories.filter((m) => m.importance >= config.minImportance);

    if (filtered.length === 0) {
      const highestId = Math.max(...memories.map((m) => m.id));
      return {
        itemsFetched: memories.length,
        itemsIngested: 0,
        message: `Fetched ${memories.length} memories, all below importance threshold (${config.minImportance})`,
        newState: { ...state, lastMemoryId: highestId },
      };
    }

    // Process each memory individually so each becomes a focused ingestion
    let ingested = 0;
    let highestId = state.lastMemoryId ?? 0;
    for (const memory of filtered) {
      const blob = this.formatMemoryForLLM(memory);
      try {
        await ingestFn({
          externalSource: "screenpipe",
          externalId: String(memory.id),
          content: blob,
          sourceLabel: `Screenpipe / ${memory.source}`,
          capturedAt: memory.created_at,
          importance: memory.importance,
          tags: memory.tags,
        });
        ingested++;
        if (memory.id > highestId) highestId = memory.id;
      } catch (err) {
        console.error(`[screenpipe] failed to ingest memory ${memory.id}:`, err);
        // Don't update cursor on failure so we retry next time
        break;
      }
    }

    // Also advance cursor past memories we filtered out
    for (const m of memories) {
      if (m.id > highestId) highestId = m.id;
    }

    return {
      itemsFetched: memories.length,
      itemsIngested: ingested,
      message: `Ingested ${ingested} of ${memories.length} memories (${memories.length - filtered.length} below importance threshold)`,
      newState: {
        ...state,
        lastMemoryId: highestId,
        totalIngested: (state.totalIngested ?? 0) + ingested,
      },
    };
  }

  private async fetchMemories(
    config: ScreenpipeConfig,
    afterId: number | undefined
  ): Promise<ScreenpipeMemory[]> {
    const url = new URL("/memories", config.baseUrl);
    url.searchParams.set("limit", String(config.maxPerSync));
    url.searchParams.set("order_by", "id");
    url.searchParams.set("order_dir", "asc");
    if (config.sourceFilter && config.sourceFilter.trim()) {
      url.searchParams.set("source", config.sourceFilter.trim());
    }
    if (config.tagFilter && config.tagFilter.trim()) {
      url.searchParams.set("tags", config.tagFilter.trim());
    }
    if (config.minImportance > 0) {
      url.searchParams.set("min_importance", String(config.minImportance));
    }

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`Screenpipe /memories fetch failed: ${res.status} ${res.statusText}`);
    }
    const json = (await res.json()) as ScreenpipeMemoryListResponse;
    let memories = json.data ?? [];

    // Filter to only memories newer than our cursor
    if (afterId !== undefined) {
      memories = memories.filter((m) => m.id > afterId);
    }

    return memories;
  }

  /** Format a single Screenpipe memory as a clean text blob for the LLM */
  private formatMemoryForLLM(memory: ScreenpipeMemory): string {
    const parts: string[] = [];
    parts.push(`Memory captured at: ${memory.created_at}`);
    parts.push(`Source: ${memory.source}`);
    parts.push(`Importance: ${memory.importance}`);
    if (memory.tags.length > 0) {
      parts.push(`Tags: ${memory.tags.join(", ")}`);
    }
    parts.push("");
    parts.push(memory.content);
    return parts.join("\n");
  }
}
