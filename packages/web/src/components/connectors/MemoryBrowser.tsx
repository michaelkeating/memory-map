import { useEffect, useState, useCallback } from "react";

interface ScreenpipeMemory {
  id: number;
  content: string;
  source: string;
  tags: string[];
  importance: number;
  created_at: string;
  imported: boolean;
  importedSourceId: string | null;
}

interface ListResponse {
  data: ScreenpipeMemory[];
  pagination: { limit: number; offset: number; total: number };
}

interface FilterOptions {
  sources: string[];
  tags: string[];
}

interface MemoryBrowserProps {
  open: boolean;
  onClose: () => void;
}

const PAGE_SIZE = 25;

export function MemoryBrowser({ open, onClose }: MemoryBrowserProps) {
  const [memories, setMemories] = useState<ScreenpipeMemory[]>([]);
  const [pagination, setPagination] = useState({ offset: 0, total: 0 });
  const [filters, setFilters] = useState<FilterOptions>({ sources: [], tags: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importingId, setImportingId] = useState<number | null>(null);

  // Filter form state
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [minImportance, setMinImportance] = useState(0);

  const fetchMemories = useCallback(
    async (offset: number = 0) => {
      setLoading(true);
      setError(null);
      try {
        const url = new URL("/api/screenpipe/memories", window.location.origin);
        url.searchParams.set("limit", String(PAGE_SIZE));
        url.searchParams.set("offset", String(offset));
        if (search.trim()) url.searchParams.set("q", search.trim());
        if (sourceFilter) url.searchParams.set("source", sourceFilter);
        if (tagFilter) url.searchParams.set("tags", tagFilter);
        if (minImportance > 0) url.searchParams.set("min_importance", String(minImportance));

        const res = await fetch(url.toString());
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? "Failed to fetch memories");
          setMemories([]);
          return;
        }
        const data = json as ListResponse;
        setMemories(data.data);
        setPagination({ offset: data.pagination.offset, total: data.pagination.total });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to reach server");
      } finally {
        setLoading(false);
      }
    },
    [search, sourceFilter, tagFilter, minImportance]
  );

  // Load filter options once
  useEffect(() => {
    if (!open) return;
    fetch("/api/screenpipe/sources")
      .then((r) => r.json())
      .then((data) => {
        if (data.sources && data.tags) setFilters(data);
      })
      .catch(() => {
        // ignore
      });
  }, [open]);

  // Refetch when filters change or panel opens
  useEffect(() => {
    if (open) {
      fetchMemories(0);
    }
  }, [open, fetchMemories]);

  const handleImport = async (memory: ScreenpipeMemory) => {
    setImportingId(memory.id);
    try {
      const res = await fetch(`/api/screenpipe/memories/${memory.id}/import`, {
        method: "POST",
      });
      if (res.ok) {
        // Mark as imported in the local list
        setMemories((prev) =>
          prev.map((m) =>
            m.id === memory.id ? { ...m, imported: true } : m
          )
        );
      } else {
        const json = await res.json();
        setError(json.detail ?? json.error ?? "Import failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImportingId(null);
    }
  };

  if (!open) return null;

  const start = pagination.offset + 1;
  const end = Math.min(pagination.offset + PAGE_SIZE, pagination.total);
  const canPrev = pagination.offset > 0;
  const canNext = pagination.offset + PAGE_SIZE < pagination.total;

  return (
    <>
      <div
        className="fixed inset-0 bg-zinc-900/30 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      <div className="fixed top-0 right-0 h-full w-[640px] bg-white border-l border-zinc-200 z-50 shadow-2xl flex flex-col">
        <div className="h-14 border-b border-zinc-200 flex items-center justify-between px-5 flex-shrink-0">
          <div>
            <h2 className="text-[15px] font-semibold text-zinc-900">Browse Screenpipe Memories</h2>
            <p className="text-[10px] text-zinc-500 mt-0.5">
              Pick specific memories to import into your graph
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

        {/* Filters */}
        <div className="border-b border-zinc-200 px-5 py-3 space-y-2 bg-zinc-50/40">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && fetchMemories(0)}
              placeholder="Search memories..."
              className="flex-1 px-3 py-1.5 text-xs rounded-md border border-zinc-200 bg-white focus:outline-none focus:border-zinc-400"
            />
            <button
              onClick={() => fetchMemories(0)}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-zinc-900 text-white hover:bg-zinc-800 transition"
            >
              Search
            </button>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="flex-1 px-2 py-1 text-xs rounded-md border border-zinc-200 bg-white focus:outline-none"
            >
              <option value="">All sources</option>
              {filters.sources.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="flex-1 px-2 py-1 text-xs rounded-md border border-zinc-200 bg-white focus:outline-none"
            >
              <option value="">All tags</option>
              {filters.tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-zinc-500 whitespace-nowrap">Min imp.</span>
              <input
                type="number"
                step="0.1"
                min="0"
                max="1"
                value={minImportance}
                onChange={(e) => setMinImportance(Number(e.target.value))}
                className="w-14 px-2 py-1 text-xs rounded-md border border-zinc-200 bg-white focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Memory list */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="p-6 text-sm text-zinc-400">Loading…</div>
          )}
          {error && (
            <div className="p-6 text-sm text-red-600">{error}</div>
          )}
          {!loading && !error && memories.length === 0 && (
            <div className="p-6 text-sm text-zinc-400">No memories match these filters.</div>
          )}
          <ul className="divide-y divide-zinc-100">
            {memories.map((m) => (
              <MemoryRow
                key={m.id}
                memory={m}
                importing={importingId === m.id}
                onImport={() => handleImport(m)}
              />
            ))}
          </ul>
        </div>

        {/* Pagination */}
        {!loading && memories.length > 0 && (
          <div className="border-t border-zinc-200 px-5 py-3 flex items-center justify-between bg-white flex-shrink-0">
            <span className="text-[11px] text-zinc-500 tabular-nums">
              {start}–{end} of {pagination.total}
            </span>
            <div className="flex gap-2">
              <button
                disabled={!canPrev}
                onClick={() => fetchMemories(Math.max(0, pagination.offset - PAGE_SIZE))}
                className="px-3 py-1 text-xs font-medium rounded-md border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                ← Prev
              </button>
              <button
                disabled={!canNext}
                onClick={() => fetchMemories(pagination.offset + PAGE_SIZE)}
                className="px-3 py-1 text-xs font-medium rounded-md border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function MemoryRow({
  memory,
  importing,
  onImport,
}: {
  memory: ScreenpipeMemory;
  importing: boolean;
  onImport: () => void;
}) {
  return (
    <li className="px-5 py-4 hover:bg-zinc-50/50 transition">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-zinc-400">
            {memory.source}
          </span>
          {memory.tags.map((t) => (
            <span
              key={t}
              className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600"
            >
              {t}
            </span>
          ))}
          <span className="text-[10px] text-zinc-400 tabular-nums">
            {formatDate(memory.created_at)}
          </span>
          <span className="text-[10px] text-zinc-400 tabular-nums">
            imp {memory.importance.toFixed(2)}
          </span>
        </div>
        {memory.imported ? (
          <span className="text-[10px] px-2 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap">
            Imported
          </span>
        ) : (
          <button
            onClick={onImport}
            disabled={importing}
            className="text-xs px-3 py-1 rounded-md bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-50 transition whitespace-nowrap"
          >
            {importing ? "Importing…" : "Import"}
          </button>
        )}
      </div>
      <p className="text-xs text-zinc-700 leading-relaxed line-clamp-3">
        {memory.content}
      </p>
    </li>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "2-digit",
  });
}
