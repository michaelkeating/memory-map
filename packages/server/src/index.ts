import Fastify from "fastify";
import fastifyWebSocket from "@fastify/websocket";
import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { initDb, closeDb } from "./storage/database.js";
import { PageStore } from "./storage/page-store.js";
import { AssociationStore } from "./storage/association-store.js";
import { ChatStore } from "./storage/chat-store.js";
import { LinkIndex } from "./engine/link-index.js";
import { GraphService } from "./engine/graph-service.js";
import { LlmManager, DEFAULT_CLAUDE_MODEL } from "./llm/llm-manager.js";
import { SettingsStore } from "./storage/settings-store.js";
import { registerSettingsRoutes } from "./api/settings.js";
import { AutoOrganizer } from "./llm/auto-organizer.js";
import { ChatHandler } from "./llm/chat-handler.js";
import { WebSocketHub } from "./ws/hub.js";
import { registerChatRoutes } from "./api/chat.js";
import { registerPageRoutes } from "./api/pages.js";
import { registerGraphRoutes } from "./api/graph.js";
import { registerConnectorRoutes } from "./api/connectors.js";
import { ConnectorStore } from "./connectors/store.js";
import { ConnectorRunner } from "./connectors/runner.js";
import { ScreenpipeConnector } from "./connectors/screenpipe.js";
import { NotionConnector } from "./connectors/notion.js";
import { GoogleDriveConnector } from "./connectors/google-drive.js";
import { registerOAuthRoutes } from "./api/oauth.js";
import { registerScreenpipeRoutes } from "./api/screenpipe.js";
import { registerTagRoutes } from "./api/tags.js";
import { registerLogRoutes } from "./api/log.js";
import { registerLintRoutes } from "./api/lint.js";
import { registerFileRoutes } from "./api/files.js";
import { SourceStore } from "./storage/source-store.js";
import { EventLogStore } from "./storage/event-log-store.js";
import { ProfileService } from "./llm/profile-service.js";
import { registerProfileRoutes } from "./api/profiles.js";
import { loadOrCreateCredentials, registerAuth, isWebSocketRequestAuthed } from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  // Initialize database
  const db = initDb();
  console.log(`Database initialized at ${config.dataDir}`);

  // Load or create auth credentials (apiKey + sessionSecret)
  const creds = loadOrCreateCredentials();

  // Initialize stores
  const pageStore = new PageStore(db);
  const associationStore = new AssociationStore(db, pageStore);
  const chatStore = new ChatStore(db);
  const sourceStore = new SourceStore(db);
  const eventLog = new EventLogStore(db);

  // Rebuild index from disk
  pageStore.rebuildIndex();
  console.log(`Page index rebuilt: ${pageStore.allTitles().length} pages`);

  // Initialize engine
  const linkIndex = new LinkIndex(db);
  linkIndex.rebuild();
  const graphService = new GraphService(pageStore, associationStore, linkIndex);

  // Initialize WebSocket hub
  const wsHub = new WebSocketHub();

  // Resolve initial LLM config: database settings take precedence over env var.
  // If neither is set, LlmManager starts in "unconfigured" state and the UI
  // nudges the user to open Settings.
  const settingsStore = new SettingsStore(db);
  const storedLlm = settingsStore.getLlm();
  const initialLlmConfig = storedLlm ?? {
    provider: "anthropic" as const,
    apiKey: config.anthropicApiKey,
    model: DEFAULT_CLAUDE_MODEL,
  };
  const llm = new LlmManager(initialLlmConfig);
  if (llm.isConfigured()) {
    const src = storedLlm ? "database" : "env var ANTHROPIC_API_KEY";
    console.log(`LLM configured: ${llm.modelId} (key from ${src})`);
  } else {
    console.warn("⚠️  No LLM API key configured. Open Memory Map → Settings to add one.");
  }
  const profileService = new ProfileService(
    db,
    llm,
    pageStore,
    associationStore,
    sourceStore,
    linkIndex
  );
  const organizer = new AutoOrganizer(
    llm,
    pageStore,
    associationStore,
    linkIndex,
    wsHub,
    sourceStore,
    profileService,
    eventLog
  );
  const chatHandler = new ChatHandler(
    llm,
    pageStore,
    associationStore,
    linkIndex,
    wsHub,
    profileService,
    sourceStore,
    eventLog
  );

  // Initialize connectors
  const connectorStore = new ConnectorStore(db);
  const connectorRunner = new ConnectorRunner(connectorStore, organizer, graphService, wsHub);
  connectorRunner.register(new ScreenpipeConnector());
  connectorRunner.register(new NotionConnector());
  connectorRunner.register(new GoogleDriveConnector(llm));
  console.log("Connectors registered: screenpipe, notion, google-drive");

  // Create Fastify app
  const app = Fastify({ logger: true });

  await app.register(fastifyCors, { origin: true, credentials: true });
  await app.register(fastifyWebSocket);

  // Auth gate for /api/* — must be registered before routes
  await registerAuth(app, creds);

  // WebSocket endpoint
  app.register(async function (fastify) {
    fastify.get("/ws", { websocket: true }, (socket, request) => {
      if (!isWebSocketRequestAuthed(request, creds)) {
        socket.send(JSON.stringify({ type: "error", error: "Unauthorized" }));
        socket.close(1008, "Unauthorized");
        return;
      }
      wsHub.register(socket);

      // Send full graph on connect
      const graph = graphService.getFullGraph();
      socket.send(JSON.stringify({ type: "graph:full", graph }));
    });
  });

  // API routes
  registerChatRoutes(app, chatHandler, chatStore, graphService, wsHub);
  registerPageRoutes(
    app,
    pageStore,
    associationStore,
    linkIndex,
    profileService,
    graphService,
    wsHub,
    sourceStore,
    eventLog
  );
  registerGraphRoutes(app, graphService);
  registerConnectorRoutes(app, connectorStore, connectorRunner);
  registerProfileRoutes(app, sourceStore, profileService, graphService, wsHub, eventLog);
  registerOAuthRoutes(app, connectorStore);
  registerScreenpipeRoutes(app, connectorStore, sourceStore, organizer, graphService, wsHub);
  registerTagRoutes(app, pageStore, linkIndex, graphService, wsHub, llm, profileService);
  registerLogRoutes(app, eventLog, pageStore, sourceStore);
  registerLintRoutes(app, pageStore, linkIndex, llm, eventLog);
  registerSettingsRoutes(app, settingsStore, llm);
  await registerFileRoutes(app, organizer, llm, graphService, wsHub);

  // Health check
  app.get("/api/health", async () => ({
    status: "ok",
    pages: pageStore.allTitles().length,
    connections: wsHub.connectionCount,
  }));

  // In production, serve the frontend static files
  const webDistPath = path.join(__dirname, "../../web/dist");
  try {
    await app.register(fastifyStatic, {
      root: webDistPath,
      prefix: "/",
      wildcard: false,
    });
    // SPA fallback
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/") || request.url === "/ws") {
        reply.code(404).send({ error: "Not found" });
      } else {
        reply.sendFile("index.html");
      }
    });
  } catch {
    console.log("No frontend build found, running API-only mode");
  }

  // Start server. Default to localhost-only; opt into LAN binding via BIND_LAN=true.
  const bindLan = process.env.BIND_LAN === "true";
  const host = bindLan ? "0.0.0.0" : "127.0.0.1";
  await app.listen({ port: config.port, host });
  if (bindLan) {
    console.log("");
    console.log(`⚠️  BIND_LAN=true — server is reachable from any device on your network.`);
    console.log(`   Anyone who can reach this machine on port ${config.port} will need the API key`);
    console.log(`   to do anything, but the login page will be visible. Prefer Tailscale or SSH`);
    console.log(`   tunnelling for remote access if you don't trust your local network.`);
    console.log("");
  }
  console.log(`Memory Map server running on http://localhost:${config.port}`);

  // Graceful shutdown
  const shutdown = () => {
    console.log("Shutting down...");
    connectorRunner.stop();
    app.close();
    closeDb();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
