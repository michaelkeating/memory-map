import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Page, Association } from "@memory-map/shared";
import { useGraphStore } from "../../hooks/useGraph.js";

interface PageViewerProps {
  pageId: string | null;
  onClose: () => void;
}

interface PageData {
  page: Page;
  backlinks: Page[];
  associations: Association[];
}

export function PageViewer({ pageId, onClose }: PageViewerProps) {
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(false);
  const nodes = useGraphStore((s) => s.nodes);

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

  if (!pageId) return null;

  const nodeLookup = new Map(nodes.map((n) => [n.id, n]));
  const titleFor = (id: string) => nodeLookup.get(id)?.title ?? id.slice(0, 8);

  return (
    <>
      <div
        className="fixed inset-0 bg-zinc-900/20 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      <div className="fixed top-0 right-0 h-full w-[520px] bg-white border-l border-zinc-200 z-50 shadow-2xl flex flex-col">
        <div className="h-14 border-b border-zinc-200 flex items-center justify-between px-5 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs uppercase tracking-wider text-zinc-400">Page</span>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-900 text-2xl leading-none w-7 h-7 flex items-center justify-center rounded hover:bg-zinc-100 transition"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="p-6 text-sm text-zinc-400">Loading…</div>
          )}
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
                    // Render [[wikilinks]] as styled spans
                    p: ({ children }) => <p>{renderWikilinks(children, titleFor)}</p>,
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
                  <ul className="space-y-1.5">
                    {data.backlinks.map((bl) => (
                      <li key={bl.frontmatter.id}>
                        <span className="text-sm text-zinc-700">
                          {bl.frontmatter.title}
                        </span>
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
                      const direction =
                        assoc.sourceId === pageId ? "→" : "←";
                      return (
                        <li
                          key={assoc.id}
                          className="rounded-md border border-zinc-200 p-3 text-sm"
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
                              {assoc.type.replace("_", " ")}
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
    </>
  );
}

/**
 * Walk the markdown children and replace [[Page]] occurrences with styled spans.
 */
function renderWikilinks(
  children: React.ReactNode,
  _titleFor: (id: string) => string
): React.ReactNode {
  if (typeof children === "string") {
    const parts = children.split(/(\[\[[^\]]+\]\])/g);
    return parts.map((part, i) => {
      const match = part.match(/^\[\[([^\]]+)\]\]$/);
      if (match) {
        return (
          <span
            key={i}
            className="px-1 py-0.5 rounded bg-zinc-100 text-zinc-700 text-[0.875em]"
          >
            {match[1]}
          </span>
        );
      }
      return part;
    });
  }
  if (Array.isArray(children)) {
    return children.map((c, i) => (
      <span key={i}>{renderWikilinks(c, _titleFor)}</span>
    ));
  }
  return children;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
