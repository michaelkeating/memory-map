import type { Connector } from "./types.js";
import type { ConnectorStore } from "./store.js";
import type { AutoOrganizer } from "../llm/auto-organizer.js";
import type { GraphService } from "../engine/graph-service.js";
import type { WebSocketHub } from "../ws/hub.js";

interface ScheduledConnector {
  connector: Connector;
  intervalSeconds: number;
  timer: NodeJS.Timeout | null;
  running: boolean;
}

export class ConnectorRunner {
  private connectors = new Map<string, ScheduledConnector>();

  constructor(
    private store: ConnectorStore,
    private organizer: AutoOrganizer,
    private graphService: GraphService,
    private wsHub: WebSocketHub
  ) {}

  /** Register a connector and ensure its DB record exists */
  register(connector: Connector): void {
    this.store.ensureExists({
      type: connector.type,
      name: connector.defaultName,
      config: connector.defaultConfig,
    });

    this.connectors.set(connector.type, {
      connector,
      intervalSeconds: connector.defaultPollSeconds,
      timer: null,
      running: false,
    });

    this.applyEnabledState(connector.type);
  }

  /** Apply current enabled state from DB (start/stop polling) */
  applyEnabledState(type: string): void {
    const sched = this.connectors.get(type);
    if (!sched) return;

    const record = this.store.getByType(type);
    if (!record) return;

    const intervalMs = (record.config.pollSeconds as number ?? sched.intervalSeconds) * 1000;

    if (record.enabled && !sched.timer) {
      console.log(`[connector:${type}] starting (interval: ${intervalMs / 1000}s)`);
      // Run once immediately, then on interval
      this.runOnce(type).catch((err) => {
        console.error(`[connector:${type}] initial sync failed:`, err);
      });
      sched.timer = setInterval(() => {
        this.runOnce(type).catch((err) => {
          console.error(`[connector:${type}] sync failed:`, err);
        });
      }, intervalMs);
    } else if (!record.enabled && sched.timer) {
      console.log(`[connector:${type}] stopping`);
      clearInterval(sched.timer);
      sched.timer = null;
    }
  }

  /** Run a single sync immediately (also called for manual trigger) */
  async runOnce(type: string): Promise<void> {
    const sched = this.connectors.get(type);
    if (!sched) throw new Error(`Unknown connector: ${type}`);
    if (sched.running) {
      console.log(`[connector:${type}] sync already in progress, skipping`);
      return;
    }

    const record = this.store.getByType(type);
    if (!record) return;

    sched.running = true;
    try {
      console.log(`[connector:${type}] syncing...`);
      const result = await sched.connector.sync(record, async (source) => {
        await this.organizer.ingest(source);
      });
      this.store.recordSync(record.id, result.newState, null);
      console.log(`[connector:${type}] sync complete: ${result.message}`);

      // Broadcast updated graph
      const graph = this.graphService.getFullGraph();
      this.wsHub.broadcast({ type: "graph:full", graph });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.store.recordSync(record.id, record.state, errMsg);
      console.error(`[connector:${type}] sync failed:`, errMsg);
      throw err;
    } finally {
      sched.running = false;
    }
  }

  /** Stop all timers (graceful shutdown) */
  stop(): void {
    for (const sched of this.connectors.values()) {
      if (sched.timer) {
        clearInterval(sched.timer);
        sched.timer = null;
      }
    }
  }
}
