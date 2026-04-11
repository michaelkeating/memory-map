import { useEffect, useState, useCallback } from "react";

interface SourceWithTags {
  name: string;
  count: number;
  tags: string[];
}

interface ExportRule {
  enabled: boolean;
  excludedTags: string[];
}

type Rules = Record<string, ExportRule>;

interface ExportRulesPanelProps {
  open: boolean;
  onClose: () => void;
}

export function ExportRulesPanel({ open, onClose }: ExportRulesPanelProps) {
  const [sources, setSources] = useState<SourceWithTags[]>([]);
  const [rules, setRules] = useState<Rules>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [expandedSource, setExpandedSource] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tree, cfg] = await Promise.all([
        fetch("/api/screenpipe/source-tag-tree").then((r) => r.json()),
        fetch("/api/screenpipe/pipe-config").then((r) => r.json()),
      ]);
      if (tree.error) {
        setError(tree.error);
      } else {
        setSources(tree.sources ?? []);
      }
      setRules(cfg.rules ?? {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const isSourceEnabled = (source: string): boolean => {
    return rules[source]?.enabled ?? false;
  };

  const isTagExcluded = (source: string, tag: string): boolean => {
    return (rules[source]?.excludedTags ?? []).includes(tag);
  };

  const setSourceEnabled = (source: string, enabled: boolean) => {
    setRules((prev) => ({
      ...prev,
      [source]: {
        enabled,
        excludedTags: prev[source]?.excludedTags ?? [],
      },
    }));
  };

  const toggleTagExcluded = (source: string, tag: string) => {
    setRules((prev) => {
      const current = prev[source] ?? { enabled: true, excludedTags: [] };
      const excluded = new Set(current.excludedTags);
      if (excluded.has(tag)) excluded.delete(tag);
      else excluded.add(tag);
      return {
        ...prev,
        [source]: {
          enabled: current.enabled,
          excludedTags: [...excluded],
        },
      };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/screenpipe/pipe-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        setError(json.error ?? "Save failed");
      } else {
        setSavedAt(Date.now());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const enabledCount = Object.values(rules).filter((r) => r.enabled).length;

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-zinc-900/30 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      <div className="fixed top-0 right-0 h-[100dvh] w-full sm:w-[560px] bg-white border-l border-zinc-200 z-50 shadow-2xl flex flex-col">
        <div className="h-14 border-b border-zinc-200 flex items-center justify-between px-5 flex-shrink-0">
          <div>
            <h2 className="text-[15px] font-semibold text-zinc-900">Pipe Export Rules</h2>
            <p className="text-[10px] text-zinc-500 mt-0.5">
              Choose which Screenpipe pipes (and tags within them) get pushed to Memory Map
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

        <div className="px-5 py-3 bg-zinc-50/50 border-b border-zinc-200 text-[11px] text-zinc-600 leading-relaxed">
          The <strong>Memory Map Sync</strong> pipe in Screenpipe runs every 30 minutes
          and pushes memories that match these rules. A memory is exported only when its
          source is enabled <em>and</em> none of its tags are excluded.
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && <div className="p-6 text-sm text-zinc-400">Loading…</div>}
          {error && <div className="p-6 text-sm text-red-600">{error}</div>}
          {!loading && !error && sources.length === 0 && (
            <div className="p-6 text-sm text-zinc-400">
              No Screenpipe memories found yet. Once your pipes start producing memories,
              they'll show up here.
            </div>
          )}
          <ul className="divide-y divide-zinc-100">
            {sources.map((source) => {
              const enabled = isSourceEnabled(source.name);
              const isExpanded = expandedSource === source.name;
              const excludedCount = rules[source.name]?.excludedTags?.length ?? 0;
              return (
                <li key={source.name}>
                  <div className="px-5 py-3 hover:bg-zinc-50/60 transition">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <button
                          onClick={() => setSourceEnabled(source.name, !enabled)}
                          className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
                            enabled ? "bg-zinc-900" : "bg-zinc-200"
                          }`}
                          aria-label={enabled ? "Disable source" : "Enable source"}
                        >
                          <span
                            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                              enabled ? "translate-x-4" : ""
                            }`}
                          />
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-zinc-900 truncate">
                            {source.name}
                          </div>
                          <div className="text-[10px] text-zinc-500 mt-0.5">
                            {source.count} memor{source.count === 1 ? "y" : "ies"}
                            {source.tags.length > 0 && (
                              <>
                                {" · "}
                                {source.tags.length} tag
                                {source.tags.length === 1 ? "" : "s"}
                                {enabled && excludedCount > 0 && (
                                  <span className="text-amber-700">
                                    {" · "}
                                    {excludedCount} excluded
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      {source.tags.length > 0 && (
                        <button
                          onClick={() =>
                            setExpandedSource(isExpanded ? null : source.name)
                          }
                          disabled={!enabled}
                          className="text-[10px] uppercase tracking-wider text-zinc-400 hover:text-zinc-700 disabled:opacity-30 transition px-2 py-1"
                        >
                          {isExpanded ? "Hide tags" : "Tags"}
                        </button>
                      )}
                    </div>

                    {isExpanded && enabled && source.tags.length > 0 && (
                      <div className="mt-3 ml-12 flex flex-wrap gap-1.5">
                        {source.tags.map((tag) => {
                          const excluded = isTagExcluded(source.name, tag);
                          return (
                            <button
                              key={tag}
                              onClick={() => toggleTagExcluded(source.name, tag)}
                              className={`text-[11px] px-2 py-1 rounded-md border transition ${
                                excluded
                                  ? "border-zinc-200 bg-zinc-50 text-zinc-400 line-through"
                                  : "border-zinc-300 bg-white text-zinc-800 hover:border-zinc-400"
                              }`}
                              title={excluded ? "Click to include" : "Click to exclude"}
                            >
                              {tag}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="border-t border-zinc-200 px-5 py-3 bg-white flex items-center justify-between flex-shrink-0">
          <span className="text-[11px] text-zinc-500">
            {enabledCount} source{enabledCount === 1 ? "" : "s"} enabled
          </span>
          <div className="flex items-center gap-3">
            {savedAt && Date.now() - savedAt < 3000 && (
              <span className="text-[10px] text-emerald-600">Saved</span>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-50 transition"
            >
              {saving ? "Saving…" : "Save rules"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
