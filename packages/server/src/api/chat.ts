import type { FastifyInstance } from "fastify";
import type { AutoOrganizer } from "../llm/auto-organizer.js";
import type { ChatStore } from "../storage/chat-store.js";
import type { GraphService } from "../engine/graph-service.js";
import type { WebSocketHub } from "../ws/hub.js";

export function registerChatRoutes(
  app: FastifyInstance,
  organizer: AutoOrganizer,
  chatStore: ChatStore,
  graphService: GraphService,
  wsHub: WebSocketHub
) {
  app.post<{ Body: { message: string } }>("/api/chat", async (request, reply) => {
    const { message } = request.body;
    if (!message?.trim()) {
      return reply.code(400).send({ error: "Message is required" });
    }

    const now = new Date().toISOString();

    // Save user message
    chatStore.save({ role: "user", content: message, timestamp: now });

    // Get recent chat history for context
    const history = chatStore.getRecent(20);
    const chatMessages = history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // Process through LLM auto-organizer
    const { response, operations } = await organizer.process(message, chatMessages);

    // Save assistant message
    const assistantTimestamp = new Date().toISOString();
    chatStore.save({
      role: "assistant",
      content: response,
      timestamp: assistantTimestamp,
      graphDelta: {
        pagesCreated: operations.createPages.map((p) => p.title),
        pagesUpdated: operations.updatePages.map((p) => p.slug),
        associationsCreated: [], // IDs are generated during execution
      },
    });

    // Send updated full graph to all clients
    const graph = graphService.getFullGraph();
    wsHub.broadcast({ type: "graph:full", graph });

    return { response, operations };
  });

  app.get("/api/chat/history", async () => {
    return chatStore.getRecent(100);
  });
}
