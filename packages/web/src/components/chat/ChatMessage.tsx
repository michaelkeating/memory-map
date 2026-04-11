import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useGraphStore } from "../../hooks/useGraph.js";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  onOpenPage: (id: string) => void;
}

export function ChatMessage({ role, content, onOpenPage }: ChatMessageProps) {
  const nodes = useGraphStore((s) => s.nodes);
  const isUser = role === "user";
  const [savingPage, setSavingPage] = useState(false);
  const [savedPageId, setSavedPageId] = useState<string | null>(null);

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl px-4 py-2.5 bg-zinc-900 text-white text-[14px] leading-relaxed whitespace-pre-wrap">
          {content}
        </div>
      </div>
    );
  }

  const handleSaveAsPage = async () => {
    // Default the title to the first line stripped of markdown
    const firstLine =
      content
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.length > 0) ?? "Saved chat answer";
    const cleanFirst = firstLine
      .replace(/^#+\s*/, "")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .slice(0, 80);

    const title = window.prompt("Save as page — title:", cleanFirst);
    if (!title || !title.trim()) return;

    setSavingPage(true);
    try {
      const res = await fetch("/api/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), content }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        alert(json.error ?? "Save failed");
        return;
      }
      setSavedPageId(json.frontmatter?.id ?? null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingPage(false);
    }
  };

  // Build resolver maps from the graph store
  const idByTitle = new Map<string, string>();
  const idByLowerTitle = new Map<string, string>();
  const idBySlug = new Map<string, string>();
  for (const n of nodes) {
    idByTitle.set(n.title, n.id);
    idByLowerTitle.set(n.title.toLowerCase(), n.id);
    idBySlug.set(n.slug, n.id);
  }
  const resolve = (target: string): string | null =>
    idByTitle.get(target) ??
    idByLowerTitle.get(target.toLowerCase()) ??
    idBySlug.get(slugify(target)) ??
    null;

  return (
    <div className="flex justify-start group">
      <div className="max-w-[90%] text-zinc-800">
        <div className="prose-mm">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => (
                <p>{renderWikilinks(children, resolve, onOpenPage)}</p>
              ),
              li: ({ children }) => (
                <li>{renderWikilinks(children, resolve, onOpenPage)}</li>
              ),
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
        <div className="mt-1 flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
          {savedPageId ? (
            <button
              onClick={() => onOpenPage(savedPageId)}
              className="text-[10px] text-emerald-700 hover:underline underline-offset-2"
            >
              Saved as page · open
            </button>
          ) : (
            <button
              onClick={handleSaveAsPage}
              disabled={savingPage}
              className="text-[10px] text-zinc-400 hover:text-zinc-700 transition disabled:opacity-50"
              title="Save this answer as a page in the graph"
            >
              {savingPage ? "Saving…" : "Save as page"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function renderWikilinks(
  children: React.ReactNode,
  resolve: (target: string) => string | null,
  onOpenPage: (id: string) => void
): React.ReactNode {
  if (typeof children === "string") {
    const parts = children.split(/(\[\[[^\]]+\]\])/g);
    return parts.map((part, i) => {
      const match = part.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
      if (match) {
        const target = match[1].trim();
        const display = (match[2] ?? target).trim();
        const id = resolve(target);
        if (id) {
          return (
            <button
              key={i}
              onClick={() => onOpenPage(id)}
              className="px-1 py-0.5 rounded bg-zinc-100 text-zinc-800 text-[0.875em] hover:bg-zinc-200 transition cursor-pointer"
            >
              {display}
            </button>
          );
        }
        return (
          <span
            key={i}
            className="px-1 py-0.5 rounded bg-zinc-50 text-zinc-400 text-[0.875em]"
            title="Page not found"
          >
            {display}
          </span>
        );
      }
      return part;
    });
  }
  if (Array.isArray(children)) {
    return children.map((c, i) => (
      <span key={i}>{renderWikilinks(c, resolve, onOpenPage)}</span>
    ));
  }
  return children;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
