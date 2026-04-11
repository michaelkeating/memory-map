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
import { ClaudeProvider } from "./llm/provider.js";
import { AutoOrganizer } from "./llm/auto-organizer.js";
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
import { SourceStore } from "./storage/source-store.js";
import { ProfileService } from "./llm/profile-service.js";
import { registerProfileRoutes } from "./api/profiles.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  // Initialize database
  const db = initDb();
  console.log(`Database initialized at ${config.dataDir}`);

  // Initialize stores
  const pageStore = new PageStore(db);
  const associationStore = new AssociationStore(db, pageStore);
  const chatStore = new ChatStore(db);
  const sourceStore = new SourceStore(db);

  // Rebuild index from disk
  pageStore.rebuildIndex();
  console.log(`Page index rebuilt: ${pageStore.allTitles().length} pages`);

  // Initialize engine
  const linkIndex = new LinkIndex(db);
  linkIndex.rebuild();
  const graphService = new GraphService(pageStore, associationStore, linkIndex);

  // Initialize WebSocket hub
  const wsHub = new WebSocketHub();

  // Check API key
  if (!config.anthropicApiKey || config.anthropicApiKey === "sk-ant-...") {
    console.error("WARNING: ANTHROPIC_API_KEY not set. Chat will fail.");
  } else {
    console.log(`Anthropic API key loaded (${config.anthropicApiKey.slice(0, 12)}...)`);
  }

  // Initialize LLM
  const llm = new ClaudeProvider("claude-sonnet-4-20250514", config.anthropicApiKey);
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
    profileService
  );

  // Initialize connectors
  const connectorStore = new ConnectorStore(db);
  const connectorRunner = new ConnectorRunner(connectorStore, organizer, graphService, wsHub);
  connectorRunner.register(new ScreenpipeConnector());
  connectorRunner.register(new NotionConnector());
  connectorRunner.register(new GoogleDriveConnector());
  console.log("Connectors registered: screenpipe, notion, google-drive");

  // Create Fastify app
  const app = Fastify({ logger: true });

  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyWebSocket);

  // WebSocket endpoint
  app.register(async function (fastify) {
    fastify.get("/ws", { websocket: true }, (socket) => {
      wsHub.register(socket);

      // Send full graph on connect
      const graph = graphService.getFullGraph();
      socket.send(JSON.stringify({ type: "graph:full", graph }));
    });
  });

  // API routes
  registerChatRoutes(app, organizer, chatStore, graphService, wsHub);
  registerPageRoutes(
    app,
    pageStore,
    associationStore,
    linkIndex,
    profileService,
    graphService,
    wsHub
  );
  registerGraphRoutes(app, graphService);
  registerConnectorRoutes(app, connectorStore, connectorRunner);
  registerProfileRoutes(app, sourceStore, profileService);
  registerOAuthRoutes(app, connectorStore);
  registerScreenpipeRoutes(app, connectorStore, sourceStore, organizer, graphService, wsHub);

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

  // Start server
  await app.listen({ port: config.port, host: "0.0.0.0" });
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
