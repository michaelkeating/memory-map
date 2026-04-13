import type { FastifyInstance } from "fastify";
import Anthropic from "@anthropic-ai/sdk";
import type { SettingsStore } from "../storage/settings-store.js";
import { AVAILABLE_CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL, type LlmManager } from "../llm/llm-manager.js";

/**
 * Return shape for GET /api/settings/llm. Never includes the raw API key —
 * just a preview (last 4 chars) so the UI can show "...ab12" to confirm
 * something is saved without leaking the secret if the screen is shared.
 */
interface LlmSettingsResponse {
  provider: "anthropic";
  model: string;
  hasApiKey: boolean;
  apiKeyPreview: string | null;
  source: "database" | "env" | "none";
  availableModels: { id: string; label: string; note?: string }[];
  defaultModel: string;
}

function previewKey(key: string): string | null {
  if (!key || key === "sk-ant-...") return null;
  if (key.length <= 8) return "••••";
  return `…${key.slice(-4)}`;
}

export function registerSettingsRoutes(
  app: FastifyInstance,
  settingsStore: SettingsStore,
  llm: LlmManager
) {
  app.get("/api/settings/llm", async () => {
    const stored = settingsStore.getLlm();
    const active = llm.config;
    const hasApiKey = llm.isConfigured();

    // Determine which source the currently-active key came from. If nothing
    // is stored in the DB but the manager is configured, the key must have
    // come from the env var at startup.
    let source: "database" | "env" | "none";
    if (!hasApiKey) source = "none";
    else if (stored) source = "database";
    else source = "env";

    const response: LlmSettingsResponse = {
      provider: "anthropic",
      model: active.model,
      hasApiKey,
      apiKeyPreview: hasApiKey ? previewKey(active.apiKey) : null,
      source,
      availableModels: AVAILABLE_CLAUDE_MODELS,
      defaultModel: DEFAULT_CLAUDE_MODEL,
    };
    return response;
  });

  app.put<{ Body: { apiKey?: string; model?: string } }>(
    "/api/settings/llm",
    async (request, reply) => {
      const body = request.body ?? {};
      const current = llm.config;

      // Merge: the client can update apiKey, model, or both. Unspecified
      // fields keep their current value so you can rotate a key without
      // re-picking your model, and vice versa.
      const nextApiKey = body.apiKey !== undefined ? body.apiKey.trim() : current.apiKey;
      const nextModel = body.model !== undefined ? body.model.trim() : current.model;

      if (body.model !== undefined) {
        const known = AVAILABLE_CLAUDE_MODELS.some((m) => m.id === nextModel);
        if (!known) {
          return reply.code(400).send({
            error: "Unknown model",
            detail: `Expected one of: ${AVAILABLE_CLAUDE_MODELS.map((m) => m.id).join(", ")}`,
          });
        }
      }

      const next = {
        provider: "anthropic" as const,
        apiKey: nextApiKey,
        model: nextModel,
      };
      settingsStore.setLlm(next);
      llm.reconfigure(next);

      return {
        ok: true,
        model: next.model,
        hasApiKey: llm.isConfigured(),
        apiKeyPreview: previewKey(next.apiKey),
      };
    }
  );

  /**
   * Verify a candidate API key + model by making a minimal API call.
   * Does NOT persist anything — the client calls PUT separately if the
   * test succeeds. Use `apiKey: null` to re-test the currently-saved key.
   */
  app.post<{ Body: { apiKey?: string | null; model?: string } }>(
    "/api/settings/llm/test",
    async (request, reply) => {
      const body = request.body ?? {};
      const current = llm.config;
      const apiKey =
        body.apiKey === null || body.apiKey === undefined || body.apiKey === ""
          ? current.apiKey
          : body.apiKey.trim();
      const model = body.model ?? current.model;

      if (!apiKey || apiKey === "sk-ant-...") {
        return reply.code(400).send({ ok: false, error: "No API key provided" });
      }

      try {
        const client = new Anthropic({ apiKey });
        await client.messages.create({
          model,
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }],
        });
        return { ok: true, model };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(200).send({ ok: false, error: message });
      }
    }
  );
}
