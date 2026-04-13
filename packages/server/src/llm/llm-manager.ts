import type Anthropic from "@anthropic-ai/sdk";
import type { LLMMessage, LLMProvider, LLMResponse } from "./provider.js";
import { ClaudeProvider } from "./provider.js";
import type { LlmSettings } from "../storage/settings-store.js";

/**
 * Available Claude model choices we expose in the Settings UI. Labels are
 * meant to be human-friendly; the `id` is what the Anthropic API expects.
 * The top of the list is the default on first run.
 */
export const AVAILABLE_CLAUDE_MODELS: { id: string; label: string; note?: string }[] = [
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", note: "Balanced — recommended default" },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6", note: "Most capable, slower, more expensive" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", note: "Fastest, cheapest" },
];

export const DEFAULT_CLAUDE_MODEL = AVAILABLE_CLAUDE_MODELS[0].id;

/**
 * Wraps an inner LLMProvider and allows it to be swapped at runtime when
 * the user changes settings. Services hold a reference to an LlmManager
 * as if it were an LLMProvider — they don't need to know the underlying
 * provider can change.
 *
 * If no API key is configured, `isConfigured()` returns false and calls
 * to `chat()` throw a clear error that the UI can surface to the user.
 */
export class LlmManager implements LLMProvider {
  private inner: LLMProvider | null;
  private _config: LlmSettings;

  constructor(initialConfig: LlmSettings) {
    this._config = initialConfig;
    this.inner = this.buildInner(initialConfig);
  }

  private buildInner(config: LlmSettings): LLMProvider | null {
    if (!config.apiKey || config.apiKey === "sk-ant-...") return null;
    return new ClaudeProvider(config.model, config.apiKey);
  }

  get modelId(): string {
    return this.inner?.modelId ?? this._config.model;
  }

  /**
   * Called by every service that needs to make an LLM request. If the user
   * hasn't configured a key, this throws instead of silently failing, so
   * the chat UI can show a clear "open Settings to configure" message.
   */
  async chat(params: {
    system: string;
    messages: LLMMessage[];
    tools?: Anthropic.Tool[];
    maxTokens?: number;
  }): Promise<LLMResponse> {
    if (!this.inner) {
      throw new Error(
        "No LLM API key configured. Open Settings (gear icon in the header) and add your Anthropic API key."
      );
    }
    return this.inner.chat(params);
  }

  /** Current (sanitized) configuration for inspection. */
  get config(): LlmSettings {
    return { ...this._config };
  }

  isConfigured(): boolean {
    return this.inner !== null;
  }

  /**
   * Swap the inner provider to match new settings. Cheap — just constructs
   * a new Anthropic SDK client; no network calls.
   */
  reconfigure(config: LlmSettings): void {
    this._config = config;
    this.inner = this.buildInner(config);
  }
}
