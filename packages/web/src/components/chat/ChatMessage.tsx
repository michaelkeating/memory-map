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

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl px-4 py-2.5 bg-zinc-900 text-white text-[14px] leading-relaxed whitespace-pre-wrap">
          {content}
        </div>
      </div>
    );
  }

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
    <div className="flex justify-start">
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
