import { useRef, useEffect } from "react";
import { useChat } from "../../hooks/useChat.js";
import { ChatMessage } from "./ChatMessage.js";
import { ChatInput } from "./ChatInput.js";

interface ChatPanelProps {
  onOpenPage: (id: string) => void;
}

export function ChatPanel({ onOpenPage }: ChatPanelProps) {
  const { messages, sendMessage, isLoading } = useChat();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="flex flex-col h-full bg-white">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-6 space-y-5">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-2 max-w-sm">
              <h2 className="text-base font-medium text-zinc-900">
                Welcome to Memory Map
              </h2>
              <p className="text-sm text-zinc-500 leading-relaxed">
                Tell me something and I'll organize it into your knowledge graph.
                Or ask me what you already know.
              </p>
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <ChatMessage
            key={i}
            role={msg.role}
            content={msg.content}
            onOpenPage={onOpenPage}
          />
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="text-xs text-zinc-400 px-1">Thinking…</div>
          </div>
        )}
      </div>
      <ChatInput onSend={sendMessage} disabled={isLoading} />
    </div>
  );
}
