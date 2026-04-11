import { useEffect, useState, useCallback } from "react";

interface LintIssue {
  type: "orphan" | "missing_page" | "untagged" | "contradiction" | "stale" | "gap";
  severity: "info" | "warning";
  message: string;
  pageIds: string[];
  suggestedTitle?: string;
}

interface LintResponse {
  issues: LintIssue[];
  summary: string;
  totalPages: number;
}

interface LintPanelProps {
  open: boolean;
  onClose: () => void;
  onOpenPage: (id: string) => void;
}

const TYPE_LABELS: Record<LintIssue["type"], string> = {
  orphan: "Orphan",
  missing_page: "Missing page",
  untagged: "Untagged",
  contradiction: "Contradiction",
  stale: "Stale claim",
  gap: "Gap",
};

const TYPE_COLORS: Record<LintIssue["type"], string> = {
  orphan: "bg-zinc-100 text-zinc-700",
  missing_page: "bg-blue-50 text-blue-700",
  untagged: "bg-zinc-100 text-zinc-700",
  contradiction: "bg-red-50 text-red-700",
  stale: "bg-amber-50 text-amber-700",
  gap: "bg-violet-50 text-violet-700",
};

export function LintPanel({ open, onClose, onOpenPage }: LintPanelProps) {
  const [result, setResult] = useState<LintResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LintIssue["type"] | "all">("all");

  const runLint = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/lint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ llm: true }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        setError(json.error ?? "Lint failed");
        return;
      }
      setResult(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lint failed");
    } finally {
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    if (open && !result) runLint();
  }, [open, result, runLint]);

  if (!open) return null;

  const filteredIssues =
    result && filter !== "all"
      ? result.issues.filter((i) => i.type === filter)
      : result?.issues ?? [];

  // Group counts for the filter chips
  const typeCounts: Record<string, number> = {};
  result?.issues.forEach((i) => {
    typeCounts[i.type] = (typeCounts[i.type] ?? 0) + 1;
  });

  return (
    <>
      <div
        className="fixed inset-0 bg-zinc-900/30 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      <div className="fixed top-0 right-0 h-[100dvh] w-full sm:w-[560px] bg-white border-l border-zinc-200 z-50 shadow-2xl flex flex-col">
        <div className="h-14 border-b border-zinc-200 flex items-center justify-between px-5 flex-shrink-0">
          <div>
            <h2 className="text-[15px] font-semibold text-zinc-900">Lint</h2>
            <p className="text-[10px] text-zinc-500 mt-0.5">
              Health-check across the whole graph
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={runLint}
              disabled={running}
              className="text-xs px-3 py-1.5 rounded-md bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-50 transition"
            >
              {running ? "Running…" : "Re-run"}
            </button>
            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-zinc-900 text-2xl leading-none w-7 h-7 flex items-center justify-center rounded hover:bg-zinc-100 transition"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        {result && (
          <div className="px-5 py-3 bg-zinc-50/60 border-b border-zinc-200">
            <p className="text-[11px] text-zinc-700">{result.summary}</p>
            <p className="text-[10px] text-zinc-500 mt-0.5">
              Across {result.totalPages} page{result.totalPages === 1 ? "" : "s"}
            </p>
            {result.issues.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                <FilterChip
                  active={filter === "all"}
                  onClick={() => setFilter("all")}
                  label={`All (${result.issues.length})`}
                />
                {Object.entries(typeCounts).map(([t, c]) => (
                  <FilterChip
                    key={t}
                    active={filter === t}
                    onClick={() => setFilter(t as LintIssue["type"])}
                    label={`${TYPE_LABELS[t as LintIssue["type"]]} (${c})`}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {error && <div className="p-6 text-sm text-red-600">{error}</div>}
          {running && !result && (
            <div className="p-6 text-sm text-zinc-400">
              Running deterministic checks + LLM review of the graph…
            </div>
          )}
          {result && filteredIssues.length === 0 && (
            <div className="p-6 text-sm text-zinc-500">
              {result.issues.length === 0
                ? "No issues found. The graph looks healthy."
                : "No issues match this filter."}
            </div>
          )}
          <ul className="divide-y divide-zinc-100">
            {filteredIssues.map((issue, i) => (
              <li
                key={i}
                className="px-5 py-3 hover:bg-zinc-50/50 transition"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider ${TYPE_COLORS[issue.type]}`}
                  >
                    {TYPE_LABELS[issue.type]}
                  </span>
                  {issue.severity === "warning" && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">
                      warning
                    </span>
                  )}
                </div>
                <p className="text-xs text-zinc-700 leading-relaxed">
                  {issue.message}
                </p>
                {issue.pageIds.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {issue.pageIds.slice(0, 5).map((pid) => (
                      <button
                        key={pid}
                        onClick={() => onOpenPage(pid)}
                        className="text-[10px] px-1.5 py-0.5 rounded border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 hover:border-zinc-300 transition"
                      >
                        Open page
                      </button>
                    ))}
                    {issue.pageIds.length > 5 && (
                      <span className="text-[10px] text-zinc-400 self-center">
                        +{issue.pageIds.length - 5} more
                      </span>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-[10px] px-2 py-0.5 rounded border transition ${
        active
          ? "border-zinc-900 bg-zinc-900 text-white"
          : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 hover:border-zinc-300"
      }`}
    >
      {label}
    </button>
  );
}
