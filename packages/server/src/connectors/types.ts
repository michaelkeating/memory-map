import type { ConnectorRecord, IngestionSource } from "@memory-map/shared";

export type IngestFn = (source: IngestionSource) => Promise<void>;

/**
 * Result of a single sync run.
 */
export interface SyncResult {
  itemsFetched: number;
  itemsIngested: number;
  message: string;
  newState: Record<string, unknown>;
}

/**
 * A connector pulls data from an external source and feeds it to the
 * auto-organizer for ingestion into the knowledge graph.
 */
export interface Connector {
  /** Unique type identifier (e.g. "screenpipe") */
  readonly type: string;

  /** Human-friendly default name */
  readonly defaultName: string;

  /** Default configuration when first created */
  readonly defaultConfig: Record<string, unknown>;

  /** Default polling interval in seconds */
  readonly defaultPollSeconds: number;

  /**
   * Run a single sync. Receives the current connector record (config + state).
   * Returns a result with new state to persist.
   *
   * The connector should:
   * 1. Fetch new items since the last sync (using state cursor)
   * 2. Pre-process / dedupe / batch them
   * 3. Call ingestFn with the formatted content
   * 4. Return updated state
   */
  sync(record: ConnectorRecord, ingestFn: IngestFn): Promise<SyncResult>;
}
