import type { FastifyInstance } from "fastify";
import type { ChatHandler } from "../llm/chat-handler.js";
import type { ChatStore } from "../storage/chat-store.js";
import type { GraphService } from "../engine/graph-service.js";
import type { WebSocketHub } from "../ws/hub.js";

export function registerChatRoutes(
  app: FastifyInstance,
  chatHandler: ChatHandler,
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

    let response: string;
    let focusedPageIds: string[];
    let touchedPageIds: string[];
    try {
      const result = await chatHandler.chat(message, chatMessages);
      response = result.response;
      focusedPageIds = result.focusedPageIds;
      touchedPageIds = result.touchedPageIds;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      request.log.error({ err }, "Chat handler failed");
      return reply.code(500).send({ error: "Chat handler failed", detail: errMsg });
    }

    // Save assistant message
    const assistantTimestamp = new Date().toISOString();
    chatStore.save({
      role: "assistant",
      content: response,
      timestamp: assistantTimestamp,
      graphDelta: {
        pagesCreated: [],
        pagesUpdated: touchedPageIds,
        associationsCreated: [],
      },
    });

    // If anything was created/modified, push the new graph
    if (touchedPageIds.length > 0) {
      const graph = graphService.getFullGraph();
      wsHub.broadcast({ type: "graph:full", graph });
    }

    return {
      response,
      focusedPageIds,
      touchedPageIds,
    };
  });

  app.get("/api/chat/history", async () => {
    return chatStore.getRecent(100);
  });
}
