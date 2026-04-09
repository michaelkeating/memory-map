import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  Page,
  Association,
  MemorySource,
  PageProfile,
} from "@memory-map/shared";
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
  sources: Array<MemorySource & { action?: string }>;
}

type AssociationSourcesMap = Record<string, MemorySource[]>;

export function PageViewer({ pageId, onClose, onNavigate }: PageViewerProps) {
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<PageProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [assocSources, setAssocSources] = useState<AssociationSourcesMap>({});
  const [expandedAssocId, setExpandedAssocId] = useState<string | null>(null);
  const nodes = useGraphStore((s) => s.nodes);
  const pinnedIds = useGraphStore((s) => s.pinnedIds);
  const togglePin = useGraphStore((s) => s.togglePin);
  const isPinned = pageId ? pinnedIds.has(pageId) : false;

  useEffect(() => {
    if (!pageId) {
      setData(null);
      setProfile(null);
      setAssocSources({});
      setExpandedAssocId(null);
      return;
    }
    setLoading(true);
    setProfileError(null);
    setExpandedAssocId(null);
    setAssocSources({});
    Promise.all([
      fetch(`/api/pages/${pageId}`).then((r) => r.json()),
      fetch(`/api/pages/${pageId}/backlinks`).then((r) => r.json()),
      fetch(`/api/pages/${pageId}/associations`).then((r) => r.json()),
      fetch(`/api/pages/${pageId}/sources`).then((r) => r.json()),
      fetch(`/api/pages/${pageId}/profile`).then((r) => r.json()),
    ])
      .then(([page, backlinks, associations, sources, prof]) => {
        if (page?.error) {
          setData(null);
        } else {
          setData({
            page,
            backlinks: Array.isArray(backlinks) ? backlinks : [],
            associations: Array.isArray(associations) ? associations : [],
            sources: Array.isArray(sources) ? sources : [],
          });
        }
        setProfile(prof && prof.profileMd ? prof : null);
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [pageId]);

  const generateProfile = async (force: boolean = false) => {
    if (!pageId) return;
    setProfileLoading(true);
    setProfileError(null);
    try {
      const url = `/api/pages/${pageId}/profile/generate${force ? "?force=true" : ""}`;
      const res = await fetch(url, { method: "POST" });
      const json = await res.json();
      if (json.error) {
        setProfileError(json.error);
      } else {
        setProfile(json);
      }
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Failed");
    } finally {
      setProfileLoading(false);
    }
  };

  const loadAssocSources = async (assocId: string) => {
    if (assocSources[assocId]) {
      setExpandedAssocId(expandedAssocId === assocId ? null : assocId);
      return;
    }
    try {
      const res = await fetch(`/api/associations/${assocId}/sources`);
      const sources = await res.json();
      setAssocSources((prev) => ({
        ...prev,
        [assocId]: Array.isArray(sources) ? sources : [],
      }));
      setExpandedAssocId(assocId);
    } catch {
      // ignore
    }
  };

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

              {/* Synthesized profile */}
              <ProfileSection
                profile={profile}
                loading={profileLoading}
                error={profileError}
                onGenerate={() => generateProfile(false)}
                onRegenerate={() => generateProfile(true)}
                resolveWikilink={resolveWikilink}
                onNavigate={onNavigate}
              />

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
                      const isExpanded = expandedAssocId === assoc.id;
                      const sourcesForAssoc = assocSources[assoc.id] ?? [];
                      return (
                        <li key={assoc.id}>
                          <div className="rounded-md border border-zinc-200 overflow-hidden">
                            <button
                              onClick={() => onNavigate(otherId)}
                              className="block w-full text-left p-3 text-sm hover:bg-zinc-50 transition"
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
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                loadAssocSources(assoc.id);
                              }}
                              className="w-full text-[10px] uppercase tracking-wider text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50 px-3 py-1.5 border-t border-zinc-100 text-left transition"
                            >
                              {isExpanded ? "Hide source memories ↑" : "Show source memories ↓"}
                            </button>
                            {isExpanded && (
                              <div className="px-3 pb-3 pt-1 space-y-2 bg-zinc-50/50 border-t border-zinc-100">
                                {sourcesForAssoc.length === 0 ? (
                                  <p className="text-[11px] text-zinc-400 italic py-1">
                                    No source memories recorded for this association.
                                  </p>
                                ) : (
                                  sourcesForAssoc.map((src) => (
                                    <SourceCard key={src.id} source={src} />
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {/* Source memories that contributed to this page */}
              {data.sources.length > 0 && (
                <section className="pt-4 border-t border-zinc-200">
                  <h3 className="text-xs uppercase tracking-wider text-zinc-400 mb-3">
                    Source Memories ({data.sources.length})
                  </h3>
                  <ul className="space-y-2">
                    {data.sources.map((src) => (
                      <li key={src.id}>
                        <SourceCard source={src} action={src.action} />
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>
    </div>
  );
}

/* ───────────────────────────────────────── Sub-components ─── */

function ProfileSection({
  profile,
  loading,
  error,
  onGenerate,
  onRegenerate,
  resolveWikilink,
  onNavigate,
}: {
  profile: PageProfile | null;
  loading: boolean;
  error: string | null;
  onGenerate: () => void;
  onRegenerate: () => void;
  resolveWikilink: (target: string) => string | null;
  onNavigate: (id: string) => void;
}) {
  if (!profile && !loading && !error) {
    return (
      <div className="rounded-md border border-dashed border-zinc-200 p-4 text-center">
        <p className="text-xs text-zinc-500 mb-2">
          No synthesized profile yet for this page.
        </p>
        <button
          onClick={onGenerate}
          className="text-xs px-3 py-1.5 rounded-md bg-zinc-900 text-white hover:bg-zinc-800 transition"
        >
          Generate profile
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-md bg-zinc-50 border border-zinc-200 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
            Profile
          </span>
          {profile && profile.stale && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
              stale
            </span>
          )}
        </div>
        <button
          onClick={onRegenerate}
          disabled={loading}
          className="text-[10px] uppercase tracking-wider text-zinc-400 hover:text-zinc-700 disabled:opacity-50 transition"
        >
          {loading ? "Generating…" : "Regenerate"}
        </button>
      </div>
      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}
      {profile && (
        <div className="prose-mm text-zinc-800">
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
            {profile.profileMd}
          </ReactMarkdown>
        </div>
      )}
      {profile && (
        <div className="text-[10px] text-zinc-400 pt-1 border-t border-zinc-200">
          From {profile.sourceCount} source memor{profile.sourceCount === 1 ? "y" : "ies"}
          {" · "}
          {formatDate(profile.generatedAt)}
        </div>
      )}
    </div>
  );
}

function SourceCard({
  source,
  action,
}: {
  source: MemorySource;
  action?: string;
}) {
  return (
    <div className="rounded border border-zinc-200 bg-white p-3 text-xs">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] uppercase tracking-wider text-zinc-400 truncate">
            {source.sourceLabel}
          </span>
          {action && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500">
              {action}
            </span>
          )}
        </div>
        <span className="text-[10px] text-zinc-400 tabular-nums whitespace-nowrap">
          {formatDate(source.capturedAt)}
        </span>
      </div>
      <p className="text-zinc-700 leading-relaxed line-clamp-4">{source.content}</p>
      {source.importance != null && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[9px] uppercase tracking-wider text-zinc-400">
            importance
          </span>
          <div className="flex-1 h-0.5 bg-zinc-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-zinc-700"
              style={{ width: `${source.importance * 100}%` }}
            />
          </div>
          <span className="text-[10px] text-zinc-400 tabular-nums">
            {source.importance.toFixed(2)}
          </span>
        </div>
      )}
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
