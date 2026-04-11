import type { FastifyInstance } from "fastify";
import type { PageStore } from "../storage/page-store.js";
import type { LinkIndex } from "../engine/link-index.js";
import type { GraphService } from "../engine/graph-service.js";
import type { WebSocketHub } from "../ws/hub.js";
import type { LLMProvider } from "../llm/provider.js";
import type { ProfileService } from "../llm/profile-service.js";

const BATCH_SIZE = 25;
const PAGE_EXCERPT_CHARS = 400;

const APPLY_TAG_PROMPT = `You're helping organize a personal knowledge graph. The user wants to find pages that should be tagged with a specific tag.

Tag: "{TAG}"
{DESCRIPTION_LINE}

Below is a batch of pages from the graph. For each page, decide if the tag clearly applies based on its title and content. Be conservative — only mark pages where the tag is a meaningful fit, not a stretch.

Return your answer as a JSON object on a single line with this exact shape:
{"matches": ["page-id-1", "page-id-2"]}

Do not include any other text or explanation. If no pages match, return {"matches": []}.

Pages:
{PAGES}`;

interface TagApplyResult {
  examined: number;
  matched: number;
  applied: string[];
  skipped: number;
}

export function registerTagRoutes(
  app: FastifyInstance,
  pageStore: PageStore,
  linkIndex: LinkIndex,
  graphService: GraphService,
  wsHub: WebSocketHub,
  llm: LLMProvider,
  profileService: ProfileService
) {
  /**
   * Retroactively apply a tag to pages where it fits, using the LLM.
   * Body: { tag, description?, dryRun? }
   * - tag: the tag name to apply
   * - description: optional natural-language explanation of what the tag means
   * - dryRun: if true, return matches without modifying any pages
   */
  app.post<{
    Body: { tag: string; description?: string; dryRun?: boolean };
  }>("/api/tags/apply", async (request, reply) => {
    const { tag, description, dryRun } = request.body ?? {};
    if (!tag || !tag.trim()) {
      return reply.code(400).send({ error: "Tag is required" });
    }

    const tagName = tag.trim();
    const allPages = pageStore.listAll();

    const result: TagApplyResult = {
      examined: 0,
      matched: 0,
      applied: [],
      skipped: 0,
    };

    // Process pages in batches to keep LLM calls efficient
    for (let i = 0; i < allPages.length; i += BATCH_SIZE) {
      const batch = allPages.slice(i, i + BATCH_SIZE);
      const batchWithContent = batch
        .map((p) => {
          const full = pageStore.getById(p.id);
          if (!full) return null;
          // Skip pages that already have the tag
          if (full.frontmatter.tags.includes(tagName)) {
            result.skipped++;
            return null;
          }
          return {
            id: p.id,
            title: p.title,
            tags: full.frontmatter.tags,
            excerpt: full.content.slice(0, PAGE_EXCERPT_CHARS),
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      if (batchWithContent.length === 0) continue;
      result.examined += batchWithContent.length;

      const pagesText = batchWithContent
        .map(
          (p, idx) =>
            `${idx + 1}. [id: ${p.id}] ${p.title}` +
            (p.tags.length > 0 ? ` (tags: ${p.tags.join(", ")})` : "") +
            `\n   ${p.excerpt.replace(/\s+/g, " ")}`
        )
        .join("\n\n");

      const prompt = APPLY_TAG_PROMPT.replace("{TAG}", tagName)
        .replace(
          "{DESCRIPTION_LINE}",
          description?.trim() ? `Description: ${description.trim()}` : ""
        )
        .replace("{PAGES}", pagesText);

      try {
        const llmResult = await llm.chat({
          system:
            "You are a careful classifier. Respond with valid JSON only — no prose.",
          messages: [{ role: "user", content: prompt }],
          maxTokens: 800,
        });

        // Parse the JSON response
        const text = llmResult.text.trim();
        const jsonMatch = text.match(/\{[\s\S]*?\}/);
        if (!jsonMatch) {
          request.log.warn(
            { tag: tagName, batchStart: i, response: text },
            "tag apply: could not find JSON in response"
          );
          continue;
        }

        let parsed: { matches?: string[] };
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch {
          request.log.warn(
            { tag: tagName, batchStart: i, response: text },
            "tag apply: invalid JSON"
          );
          continue;
        }

        const matchedIds = parsed.matches ?? [];
        result.matched += matchedIds.length;

        if (!dryRun) {
          for (const id of matchedIds) {
            const page = pageStore.getById(id);
            if (!page) continue;
            const newTags = [...new Set([...page.frontmatter.tags, tagName])];
            const updated = pageStore.updateById(id, { tags: newTags });
            if (updated) {
              linkIndex.updateForPage(id, updated.links);
              profileService.markStale(id);
              wsHub.broadcast({ type: "page:updated", page: updated });
              result.applied.push(id);
            }
          }
        } else {
          // Dry run: report matches but don't apply
          result.applied.push(...matchedIds);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        request.log.error({ err, tag: tagName, batchStart: i }, "tag apply batch failed");
        // Continue with the next batch instead of failing the whole request
        void msg;
      }
    }

    // Push graph update if anything changed
    if (!dryRun && result.applied.length > 0) {
      const graph = graphService.getFullGraph();
      wsHub.broadcast({ type: "graph:full", graph });
    }

    return result;
  });
}
