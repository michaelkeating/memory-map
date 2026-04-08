import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Page, Association } from "@memory-map/shared";
import { useGraphStore } from "../../hooks/useGraph.js";

interface PageViewerProps {
  pageId: string | null;
  onClose: () => void;
  onNavigate: (id: string) => void;
}

interface PageData {
  page: Page;
  backlinks: Page[];
  associations: Association[];
}

export function PageViewer({ pageId, onClose, onNavigate }: PageViewerProps) {
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(false);
  const nodes = useGraphStore((s) => s.nodes);
  const pinnedIds = useGraphStore((s) => s.pinnedIds);
  const togglePin = useGraphStore((s) => s.togglePin);
  const isPinned = pageId ? pinnedIds.has(pageId) : false;

  useEffect(() => {
    if (!pageId) {
      setData(null);
      return;
    }
    setLoading(true);
    Promise.all([
      fetch(`/api/pages/${pageId}`).then((r) => r.json()),
      fetch(`/api/pages/${pageId}/backlinks`).then((r) => r.json()),
      fetch(`/api/pages/${pageId}/associations`).then((r) => r.json()),
    ])
      .then(([page, backlinks, associations]) => {
        if (page?.error) {
          setData(null);
        } else {
          setData({
            page,
            backlinks: Array.isArray(backlinks) ? backlinks : [],
            associations: Array.isArray(associations) ? associations : [],
          });
        }
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [pageId]);

  // Build title→id and slug→id maps for resolving wikilinks
  const idByTitle = new Map<string, string>();
  const idByLowerTitle = new Map<string, string>();
  const idBySlug = new Map<string, string>();
  const titleById = new Map<string, string>();
  for (const n of nodes) {
    idByTitle.set(n.title, n.id);
    idByLowerTitle.set(n.title.toLowerCase(), n.id);
    idBySlug.set(n.slug, n.id);
    titleById.set(n.id, n.title);
  }

  const titleFor = (id: string) => titleById.get(id) ?? id.slice(0, 8);

  const resolveWikilink = (target: string): string | null => {
    return (
      idByTitle.get(target) ??
      idByLowerTitle.get(target.toLowerCase()) ??
      idBySlug.get(slugify(target)) ??
      null
    );
  };

  return (
    <div className="h-full bg-white flex flex-col">
        <div className="h-14 border-b border-zinc-200 flex items-center justify-between px-5 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs uppercase tracking-wider text-zinc-400">Page</span>
          </div>
          <div className="flex items-center gap-2">
            {pageId && (
              <button
                onClick={() => togglePin(pageId)}
                className={`text-xs px-2.5 py-1 rounded-md border transition flex items-center gap-1.5 ${
                  isPinned
                    ? "border-zinc-900 bg-zinc-900 text-white hover:bg-zinc-800"
                    : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 hover:border-zinc-300"
                }`}
                title={isPinned ? "Unpin from graph" : "Pin to graph"}
              >
                <PinIcon filled={isPinned} />
                {isPinned ? "Pinned" : "Pin"}
              </button>
            )}
            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-zinc-900 text-2xl leading-none w-7 h-7 flex items-center justify-center rounded hover:bg-zinc-100 transition"
              aria-label="Close page panel"
              title="Close"
            >
              ×
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && <div className="p-6 text-sm text-zinc-400">Loading…</div>}
          {!loading && !data && (
            <div className="p-6 text-sm text-zinc-400">Page not found.</div>
          )}
          {data && (
            <div className="p-6 space-y-6">
              <header className="space-y-2">
                <h1 className="text-2xl font-semibold text-zinc-900 tracking-tight">
                  {data.page.frontmatter.title}
                </h1>
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <span>{formatDate(data.page.frontmatter.modified)}</span>
                  {data.page.frontmatter.tags.length > 0 && (
                    <>
                      <span>·</span>
                      <div className="flex gap-1.5">
                        {data.page.frontmatter.tags.map((tag) => (
                          <span
                            key={tag}
                            className="px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600 text-[11px]"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </header>

              <article className="prose-mm">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    p: ({ children }) => (
                      <p>{renderWikilinks(children, resolveWikilink, onNavigate)}</p>
                    ),
                    li: ({ children }) => (
                      <li>{renderWikilinks(children, resolveWikilink, onNavigate)}</li>
                    ),
                  }}
                >
                  {data.page.content}
                </ReactMarkdown>
              </article>

              {data.backlinks.length > 0 && (
                <section className="pt-4 border-t border-zinc-200">
                  <h3 className="text-xs uppercase tracking-wider text-zinc-400 mb-3">
                    Backlinks ({data.backlinks.length})
                  </h3>
                  <ul className="space-y-1">
                    {data.backlinks.map((bl) => (
                      <li key={bl.frontmatter.id}>
                        <button
                          onClick={() => onNavigate(bl.frontmatter.id)}
                          className="text-sm text-zinc-700 hover:text-zinc-900 hover:underline underline-offset-2 decoration-zinc-300 text-left w-full py-1"
                        >
                          {bl.frontmatter.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {data.associations.length > 0 && (
                <section className="pt-4 border-t border-zinc-200">
                  <h3 className="text-xs uppercase tracking-wider text-zinc-400 mb-3">
                    Semantic Associations ({data.associations.length})
                  </h3>
                  <ul className="space-y-3">
                    {data.associations.map((assoc) => {
                      const otherId =
                        assoc.sourceId === pageId ? assoc.targetId : assoc.sourceId;
                      const direction = assoc.sourceId === pageId ? "→" : "←";
                      return (
                        <li key={assoc.id}>
                          <button
                            onClick={() => onNavigate(otherId)}
                            className="block w-full text-left rounded-md border border-zinc-200 p-3 text-sm hover:border-zinc-400 hover:bg-zinc-50 transition"
                          >
                            <div className="flex items-baseline justify-between gap-3">
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <span className="text-zinc-400 text-xs font-mono">
                                  {direction}
                                </span>
                                <span className="font-medium text-zinc-900 truncate">
                                  {titleFor(otherId)}
                                </span>
                              </div>
                              <span className="text-[10px] uppercase tracking-wider text-zinc-400 whitespace-nowrap">
                                {assoc.type.replace(/_/g, " ")}
                              </span>
                            </div>
                            <div className="text-xs text-zinc-500 mt-1.5 leading-relaxed">
                              {assoc.reason}
                            </div>
                            <div className="mt-2 flex items-center gap-2">
                              <div className="flex-1 h-1 bg-zinc-100 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-zinc-900"
                                  style={{ width: `${assoc.weight * 100}%` }}
                                />
                              </div>
                              <span className="text-[10px] text-zinc-400 tabular-nums">
                                {assoc.weight.toFixed(2)}
                              </span>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>
    </div>
  );
}

/**
 * Walk markdown children and replace [[Page]] occurrences with clickable buttons.
 */
function renderWikilinks(
  children: React.ReactNode,
  resolve: (target: string) => string | null,
  onNavigate: (id: string) => void
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
              onClick={() => onNavigate(id)}
              className="px-1 py-0.5 rounded bg-zinc-100 text-zinc-800 text-[0.875em] hover:bg-zinc-200 transition cursor-pointer"
            >
              {display}
            </button>
          );
        }
        // Unresolved wikilink — render as gray, non-clickable
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
      <span key={i}>{renderWikilinks(c, resolve, onNavigate)}</span>
    ));
  }
  return children;
}

function PinIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="17" x2="12" y2="22" />
      <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
    </svg>
  );
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
