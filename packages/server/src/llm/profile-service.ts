import type Database from "better-sqlite3";
import type { PageProfile } from "@memory-map/shared";
import type { LLMProvider } from "./provider.js";
import type { PageStore } from "../storage/page-store.js";
import type { AssociationStore } from "../storage/association-store.js";
import type { SourceStore } from "../storage/source-store.js";
import type { LinkIndex } from "../engine/link-index.js";

const PROFILE_SYSTEM_PROMPT = `You are synthesizing a rich profile of an entity in the user's personal knowledge graph. The user has captured fragments of observations over time. Your job is to weave them into a coherent character sketch.

Tone: thoughtful, observational, like a notebook entry written by someone who knows the entity well. Quietly confident. Not a wikipedia article. Not a bulleted list.

Length: 3 to 5 short paragraphs. Aim for ~200 words.

Form: clean markdown. No headings. Optionally end with one or two italicized "recurring themes" lines.

Tailor by entity type:
- PERSON: their interests, expertise, recurring concerns, relationships, the way they tend to think or speak. What kind of person are they?
- PROJECT: its arc and current state, key decisions made, stakeholders, what's at stake, where it might be heading.
- CONCEPT: how the user thinks about it, what it connects to in their world, the contexts where it appears.
- COMPANY/ORGANIZATION: what it is to the user, their relationship to it, what activities or people it represents.

Don't repeat the title in the body. Don't open with "X is..." — just begin.

Don't invent facts. If the source material is sparse, be honest and brief. Better a confident two-sentence sketch than padded fluff.

If the source material describes only one or two things, write a tight paragraph or two — don't pad.`;

export class ProfileService {
  constructor(
    private db: Database.Database,
    private llm: LLMProvider,
    private pageStore: PageStore,
    private associationStore: AssociationStore,
    private sourceStore: SourceStore,
    private linkIndex: LinkIndex
  ) {}

  /** Get the cached profile, or null if none exists */
  getCached(pageId: string): PageProfile | null {
    const row = this.db
      .prepare("SELECT * FROM page_profiles WHERE page_id = ?")
      .get(pageId) as any;
    return row ? rowToProfile(row) : null;
  }

  /** Mark a profile stale (called when new content touches the page) */
  markStale(pageId: string): void {
    this.db
      .prepare("UPDATE page_profiles SET stale = 1 WHERE page_id = ?")
      .run(pageId);
  }

  /** Get the profile, generating if missing or stale */
  async getOrGenerate(pageId: string): Promise<PageProfile | null> {
    const cached = this.getCached(pageId);
    if (cached && !cached.stale) return cached;
    return this.generate(pageId);
  }

  /** Force regenerate the profile */
  async generate(pageId: string): Promise<PageProfile | null> {
    const page = this.pageStore.getById(pageId);
    if (!page) return null;

    // Gather context: page content, source memories, neighbors, associations
    const sources = this.sourceStore.getPageSources(pageId);
    const associations = this.associationStore.getForPage(pageId);
    const backlinkIds = this.linkIndex.getBacklinks(pageId);
    const forwardIds = this.linkIndex.getForwardLinks(pageId);
    const neighborIds = new Set([...backlinkIds, ...forwardIds]);
    const neighbors = [...neighborIds]
      .map((id) => this.pageStore.getById(id))
      .filter((p): p is NonNullable<typeof p> => p !== null);

    const tagLine = page.frontmatter.tags.length > 0
      ? page.frontmatter.tags.join(", ")
      : "(no tags)";

    let prompt = `ENTITY: ${page.frontmatter.title}\nTAGS: ${tagLine}\n\n`;

    if (page.content.trim().length > 0) {
      prompt += `=== PAGE NOTES ===\n${page.content.trim()}\n\n`;
    }

    if (sources.length > 0) {
      prompt += `=== CAPTURED OBSERVATIONS (${sources.length}) ===\n`;
      for (const s of sources.slice(0, 30)) {
        prompt += `[${s.capturedAt}] ${s.sourceLabel}`;
        if (s.importance != null) prompt += ` (importance: ${s.importance})`;
        prompt += `\n${s.content}\n\n`;
      }
    }

    if (neighbors.length > 0) {
      prompt += `=== CONNECTED IN THE GRAPH ===\n`;
      for (const n of neighbors.slice(0, 20)) {
        prompt += `- ${n.frontmatter.title}`;
        if (n.frontmatter.tags.length > 0) {
          prompt += ` [${n.frontmatter.tags.join(", ")}]`;
        }
        prompt += `\n`;
      }
      prompt += `\n`;
    }

    if (associations.length > 0) {
      prompt += `=== SEMANTIC ASSOCIATIONS ===\n`;
      for (const a of associations.slice(0, 15)) {
        const otherId = a.sourceId === pageId ? a.targetId : a.sourceId;
        const other = this.pageStore.getById(otherId);
        if (!other) continue;
        const direction = a.sourceId === pageId ? "→" : "←";
        prompt += `${direction} ${other.frontmatter.title} [${a.type}, ${a.weight.toFixed(2)}]: ${a.reason}\n`;
      }
      prompt += `\n`;
    }

    prompt += `Now write the profile.`;

    const result = await this.llm.chat({
      system: PROFILE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
      maxTokens: 800,
    });

    const profileMd = result.text.trim();
    if (!profileMd) return null;

    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT OR REPLACE INTO page_profiles
          (page_id, profile_md, source_count, generated_at, generated_by, stale)
         VALUES (?, ?, ?, ?, ?, 0)`
      )
      .run(pageId, profileMd, sources.length, now, this.llm.modelId);

    return {
      pageId,
      profileMd,
      sourceCount: sources.length,
      generatedAt: now,
      generatedBy: this.llm.modelId,
      stale: false,
    };
  }
}

function rowToProfile(row: any): PageProfile {
  return {
    pageId: row.page_id,
    profileMd: row.profile_md,
    sourceCount: row.source_count,
    generatedAt: row.generated_at,
    generatedBy: row.generated_by,
    stale: Boolean(row.stale),
  };
}
