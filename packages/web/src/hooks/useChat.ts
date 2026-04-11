import { useState, useCallback, useEffect } from "react";
import { useGraphStore } from "./useGraph.js";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const setFocusedIds = useGraphStore((s) => s.setFocusedIds);

  // Load chat history on mount
  useEffect(() => {
    fetch("/api/chat/history")
      .then((r) => r.json())
      .then((history: ChatMessage[]) => {
        if (Array.isArray(history) && history.length > 0) {
          setMessages(history);
        }
      })
      .catch(() => {
        // ignore fetch errors
      });
  }, []);

  const sendMessage = useCallback(async (content: string) => {
    const userMsg: ChatMessage = {
      role: "user",
      content,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: content }),
      });
      const data = await res.json();

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: data.response,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

      // Focus the graph on whatever pages this turn surfaced
      if (Array.isArray(data.focusedPageIds)) {
        setFocusedIds(data.focusedPageIds);
      }
    } catch (err) {
      const errorMsg: ChatMessage = {
        role: "assistant",
        content: `Error: ${err instanceof Error ? err.message : "Failed to get response"}`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { messages, sendMessage, isLoading };
}
