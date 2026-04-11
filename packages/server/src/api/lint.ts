import type { FastifyInstance } from "fastify";
import type { PageStore } from "../storage/page-store.js";
import type { LinkIndex } from "../engine/link-index.js";
import type { LLMProvider } from "../llm/provider.js";
import type { EventLogStore } from "../storage/event-log-store.js";

export type LintIssue = {
  type:
    | "orphan"
    | "missing_page"
    | "untagged"
    | "contradiction"
    | "stale"
    | "gap";
  severity: "info" | "warning";
  message: string;
  pageIds: string[];
  /** For missing_page issues, the title that was referenced but doesn't exist */
  suggestedTitle?: string;
};

const LLM_LINT_PROMPT = `You are reviewing a personal knowledge graph for issues. Below is a snapshot of the user's pages: titles, tags, and short excerpts. Identify potential issues across the graph as a whole.

Look for:
- **Contradictions**: pages whose claims conflict with each other
- **Stale claims**: information that newer pages have superseded
- **Important gaps**: concepts mentioned in multiple pages that don't have their own dedicated page
- **Missing cross-references**: pages that clearly relate but don't link to each other
- **Suggested investigations**: questions worth asking, follow-ups, things the user might want to look into

Return a JSON object on a single line:

{"issues": [{"type": "<one of: contradiction, stale, gap, missing_page>", "severity": "<info|warning>", "message": "<one sentence>", "pageIds": ["<id1>", "<id2>"], "suggestedTitle": "<for missing_page only>"}]}

Be selective. Only flag genuine issues — don't manufacture problems. If the graph looks healthy, return {"issues": []}.

Pages:
{PAGES}`;

export function registerLintRoutes(
  app: FastifyInstance,
  pageStore: PageStore,
  linkIndex: LinkIndex,
  llm: LLMProvider,
  eventLog: EventLogStore
) {
  app.post<{ Body: { llm?: boolean } }>(
    "/api/lint",
    async (request, reply) => {
      const useLLM = request.body?.llm ?? true;
      const issues: LintIssue[] = [];

      // ─── Cheap deterministic checks ──────────────────────────
      const allPages = pageStore.listAll();

      // 1. Orphan pages: no incoming or outgoing explicit links
      for (const p of allPages) {
        const fwd = linkIndex.getForwardLinks(p.id);
        const back = linkIndex.getBacklinks(p.id);
        if (fwd.length === 0 && back.length === 0) {
          issues.push({
            type: "orphan",
            severity: "info",
            message: `"${p.title}" has no links to or from any other page`,
            pageIds: [p.id],
          });
        }
      }

      // 2. Missing pages: any [[wikilink]] in any page that doesn't resolve
      const referencedTitles = new Map<string, string[]>(); // lower title -> referencing page ids
      for (const p of allPages) {
        const full = pageStore.getById(p.id);
        if (!full) continue;
        const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
        let match: RegExpExecArray | null;
        while ((match = re.exec(full.content)) !== null) {
          const target = match[1].trim();
          const id = pageStore.resolveToId(target);
          if (!id) {
            const lower = target.toLowerCase();
            if (!referencedTitles.has(lower)) {
              referencedTitles.set(lower, []);
            }
            referencedTitles.get(lower)!.push(p.id);
          }
        }
      }
      for (const [lower, refs] of referencedTitles) {
        // Recover the original casing from the first reference
        issues.push({
          type: "missing_page",
          severity: "info",
          message: `[[${lower}]] is referenced by ${refs.length} page${refs.length === 1 ? "" : "s"} but doesn't exist yet`,
          pageIds: refs,
          suggestedTitle: lower,
        });
      }

      // 3. Untagged pages
      for (const p of allPages) {
        if (!p.tags || p.tags.length === 0) {
          issues.push({
            type: "untagged",
            severity: "info",
            message: `"${p.title}" has no tags`,
            pageIds: [p.id],
          });
        }
      }

      // ─── LLM-driven semantic checks ─────────────────────────
      // Single-pass review of the whole graph (titles + excerpts).
      // For very large graphs we'd batch; this works fine up to ~150 pages.
      if (useLLM && allPages.length > 0 && allPages.length <= 200) {
        const sample = allPages.slice(0, 150);
        const pagesText = sample
          .map((p) => {
            const full = pageStore.getById(p.id);
            const excerpt = full?.content.slice(0, 250).replace(/\s+/g, " ") ?? "";
            const tagLine = p.tags.length > 0 ? ` [${p.tags.join(", ")}]` : "";
            return `id:${p.id} | ${p.title}${tagLine}\n  ${excerpt}`;
          })
          .join("\n\n");

        const prompt = LLM_LINT_PROMPT.replace("{PAGES}", pagesText);

        try {
          const result = await llm.chat({
            system:
              "You are a careful editor of a personal knowledge graph. Respond with valid JSON only.",
            messages: [{ role: "user", content: prompt }],
            maxTokens: 2000,
          });
          const text = result.text.trim();
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]) as { issues?: LintIssue[] };
            if (parsed.issues && Array.isArray(parsed.issues)) {
              for (const issue of parsed.issues) {
                issues.push({
                  type: issue.type ?? "gap",
                  severity: issue.severity ?? "info",
                  message: issue.message ?? "",
                  pageIds: Array.isArray(issue.pageIds) ? issue.pageIds : [],
                  suggestedTitle: issue.suggestedTitle,
                });
              }
            }
          }
        } catch (err) {
          request.log.warn({ err }, "lint LLM call failed");
        }
      } else if (useLLM && allPages.length > 200) {
        issues.push({
          type: "gap",
          severity: "info",
          message: `Graph is too large for one-pass LLM review (${allPages.length} pages). Consider batching.`,
          pageIds: [],
        });
      }

      // Group counts for the log entry summary
      const counts: Record<string, number> = {};
      for (const i of issues) counts[i.type] = (counts[i.type] ?? 0) + 1;
      const summary =
        issues.length === 0
          ? "Clean — no issues found"
          : `Found ${issues.length} issue${issues.length === 1 ? "" : "s"}: ${Object.entries(counts)
              .map(([k, v]) => `${v} ${k}`)
              .join(", ")}`;

      eventLog.log({
        type: "lint",
        text: summary,
        meta: { count: issues.length, counts },
      });

      void reply;
      return { issues, summary, totalPages: allPages.length };
    }
  );
}
