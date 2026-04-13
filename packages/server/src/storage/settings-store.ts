import type { Database } from "better-sqlite3";

/**
 * LLM configuration persisted in the database. Today the only provider is
 * Anthropic (Claude). The `provider` field is present now so that adding
 * OpenAI/Gemini later doesn't require a schema migration.
 */
export interface LlmSettings {
  provider: "anthropic";
  apiKey: string;
  model: string;
}

const LLM_KEY = "llm";

/**
 * Tiny key/value store over the `settings` table. Values are JSON-encoded.
 * Shared with any future app-wide preference we want to persist.
 */
export class SettingsStore {
  constructor(private db: Database) {}

  getLlm(): LlmSettings | null {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(LLM_KEY) as { value: string } | undefined;
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.value) as LlmSettings;
      if (parsed.provider === "anthropic" && typeof parsed.apiKey === "string" && typeof parsed.model === "string") {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  setLlm(settings: LlmSettings): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(LLM_KEY, JSON.stringify(settings), now);
  }
}
