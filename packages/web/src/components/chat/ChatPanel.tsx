import { useRef, useEffect } from "react";
import { useChat } from "../../hooks/useChat.js";
import { ChatMessage } from "./ChatMessage.js";
import { ChatInput } from "./ChatInput.js";

interface ChatPanelProps {
  onOpenPage: (id: string) => void;
  /**
   * Whether the LLM is configured. `null` means we haven't checked yet —
   * render nothing so we don't flash a setup banner for already-configured users.
   */
  llmConfigured: boolean | null;
  onOpenSettings: () => void;
}

export function ChatPanel({ onOpenPage, llmConfigured, onOpenSettings }: ChatPanelProps) {
  const { messages, sendMessage, isLoading } = useChat();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const showSetupBanner = llmConfigured === false;

  return (
    <div className="flex flex-col h-full bg-white">
      {showSetupBanner && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 sm:px-6 py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[12px] font-medium text-amber-900">
              Add an API key to start using Memory Map
            </div>
            <p className="text-[11px] text-amber-800/90 mt-0.5 leading-relaxed">
              Chat, auto-organizing, and page profiles all need a Claude API
              key. Memory Map runs entirely on your machine — the key never
              leaves it.
            </p>
          </div>
          <button
            onClick={onOpenSettings}
            className="flex-shrink-0 text-[11px] font-medium px-2.5 py-1.5 rounded-md bg-amber-900 text-amber-50 hover:bg-amber-800 transition"
          >
            Open Settings
          </button>
        </div>
      )}
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
