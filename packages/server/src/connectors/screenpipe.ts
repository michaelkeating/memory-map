import type { Connector, SyncResult, IngestFn } from "./types.js";
import type { ConnectorRecord } from "@memory-map/shared";

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
}

const DEFAULT_CONFIG: ScreenpipeConfig = {
  baseUrl: "http://localhost:3030",
  pollSeconds: 600, // 10 minutes
  minImportance: 0.5,
  maxPerSync: 50,
  ingestHistorical: true,
};

export class ScreenpipeConnector implements Connector {
  readonly type = "screenpipe";
  readonly defaultName = "Screenpipe Memories";
  readonly defaultConfig = DEFAULT_CONFIG as unknown as Record<string, unknown>;
  readonly defaultPollSeconds = DEFAULT_CONFIG.pollSeconds;

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
