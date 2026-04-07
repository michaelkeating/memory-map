import { useRef, useEffect } from "react";
import { useChat } from "../../hooks/useChat.js";
import { ChatMessage } from "./ChatMessage.js";
import { ChatInput } from "./ChatInput.js";

export function ChatPanel() {
  const { messages, sendMessage, isLoading } = useChat();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center space-y-2">
              <p className="text-lg font-medium">Welcome to Memory Map</p>
              <p className="text-sm">
                Tell me something and I'll organize it into your knowledge graph.
              </p>
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <ChatMessage key={i} role={msg.role} content={msg.content} />
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-800 border border-gray-700 rounded-2xl px-4 py-3 text-gray-400">
              Thinking...
            </div>
          </div>
        )}
      </div>
      <ChatInput onSend={sendMessage} disabled={isLoading} />
    </div>
  );
}
