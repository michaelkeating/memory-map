import { useEffect, useState, useCallback } from "react";

interface LogEntry {
  id: string;
  type:
    | "ingest"
    | "page_create"
    | "page_update"
    | "page_delete"
    | "source_delete"
    | "source_block"
    | "lint"
    | "chat_query";
  createdAt: string;
  text: string | null;
  meta: Record<string, unknown> | null;
  pageId: string | null;
  sourceId: string | null;
  pageTitle: string | null;
  pageDeleted: boolean;
  sourceLabel: string | null;
  sourceRemoved: boolean;
}

interface LogPanelProps {
  open: boolean;
  onClose: () => void;
  onOpenPage: (id: string) => void;
}

const TYPE_LABELS: Record<LogEntry["type"], string> = {
  ingest: "Ingested",
  page_create: "Created",
  page_update: "Edited",
  page_delete: "Deleted",
  source_delete: "Removed source",
  source_block: "Blocked source",
  lint: "Lint",
  chat_query: "Asked",
};

const TYPE_COLORS: Record<LogEntry["type"], string> = {
  ingest: "text-blue-600",
  page_create: "text-emerald-600",
  page_update: "text-amber-600",
  page_delete: "text-red-600",
  source_delete: "text-red-600",
  source_block: "text-amber-600",
  lint: "text-violet-600",
  chat_query: "text-zinc-600",
};

export function LogPanel({ open, onClose, onOpenPage }: LogPanelProps) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/log?limit=200");
      const data = await res.json();
      if (Array.isArray(data)) setEntries(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const deleteEntry = async (id: string) => {
    await fetch(`/api/log/${id}`, { method: "DELETE" });
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const clearChatQueries = async () => {
    if (!confirm("Permanently delete all logged chat queries?")) return;
    await fetch("/api/log/chat-queries/all", { method: "DELETE" });
    refresh();
  };

  if (!open) return null;

  const chatQueryCount = entries.filter((e) => e.type === "chat_query").length;

  return (
    <>
      <div
        className="fixed inset-0 bg-zinc-900/30 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      <div className="fixed top-0 right-0 h-[100dvh] w-full sm:w-[500px] bg-white border-l border-zinc-200 z-50 shadow-2xl flex flex-col">
        <div className="h-14 border-b border-zinc-200 flex items-center justify-between px-5 flex-shrink-0">
          <div>
            <h2 className="text-[15px] font-semibold text-zinc-900">Log</h2>
            <p className="text-[10px] text-zinc-500 mt-0.5">
              Recent ingest, edit, delete, lint, and chat events
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-900 text-2xl leading-none w-7 h-7 flex items-center justify-center rounded hover:bg-zinc-100 transition"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {chatQueryCount > 0 && (
          <div className="px-5 py-2 bg-zinc-50/60 border-b border-zinc-200 flex items-center justify-between">
            <span className="text-[10px] text-zinc-500">
              {chatQueryCount} logged chat quer{chatQueryCount === 1 ? "y" : "ies"}
            </span>
            <button
              onClick={clearChatQueries}
              className="text-[10px] text-red-600 hover:text-red-700 underline-offset-2 hover:underline"
            >
              Clear all chat queries
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {loading && entries.length === 0 && (
            <div className="p-6 text-sm text-zinc-400">Loading…</div>
          )}
          {!loading && entries.length === 0 && (
            <div className="p-6 text-sm text-zinc-400">
              No log entries yet. Edit a page or chat with your graph to start
              recording events.
            </div>
          )}
          <ul className="divide-y divide-zinc-100">
            {entries.map((entry) => (
              <LogRow
                key={entry.id}
                entry={entry}
                onOpenPage={onOpenPage}
                onDelete={() => deleteEntry(entry.id)}
              />
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}

function LogRow({
  entry,
  onOpenPage,
  onDelete,
}: {
  entry: LogEntry;
  onOpenPage: (id: string) => void;
  onDelete: () => void;
}) {
  const label = TYPE_LABELS[entry.type];
  const color = TYPE_COLORS[entry.type];

  // Resolve subject
  let subject: React.ReactNode = "";
  if (entry.pageId) {
    if (entry.pageDeleted) {
      subject = <span className="text-zinc-400 italic">[deleted page]</span>;
    } else {
      subject = (
        <button
          onClick={() => onOpenPage(entry.pageId!)}
          className="font-medium text-zinc-900 hover:underline underline-offset-2"
        >
          {entry.pageTitle}
        </button>
      );
    }
  } else if (entry.sourceId) {
    if (entry.sourceRemoved) {
      subject = <span className="text-zinc-400 italic">[removed source]</span>;
    } else {
      subject = <span className="text-zinc-700">{entry.sourceLabel}</span>;
    }
  } else if (entry.text) {
    subject = (
      <span className="text-zinc-700 italic">
        "{entry.text.length > 80 ? entry.text.slice(0, 80) + "…" : entry.text}"
      </span>
    );
  }

  // Allow deleting chat queries and lint entries (the inherently-content ones)
  const canDelete = entry.type === "chat_query" || entry.type === "lint";

  return (
    <li className="px-5 py-3 hover:bg-zinc-50/40 transition group">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-[11px] uppercase tracking-wider ${color}`}>
              {label}
            </span>
            <span className="text-[10px] text-zinc-400 tabular-nums">
              {formatRelative(entry.createdAt)}
            </span>
          </div>
          <div className="text-xs mt-1 truncate">{subject}</div>
        </div>
        {canDelete && (
          <button
            onClick={onDelete}
            className="text-zinc-300 hover:text-red-600 opacity-0 group-hover:opacity-100 transition text-base leading-none px-1"
            title="Remove this log entry"
          >
            ×
          </button>
        )}
      </div>
    </li>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
