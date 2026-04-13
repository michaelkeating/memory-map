import { useCallback, useEffect, useState } from "react";

interface LlmSettings {
  provider: "anthropic";
  model: string;
  hasApiKey: boolean;
  apiKeyPreview: string | null;
  source: "database" | "env" | "none";
  availableModels: { id: string; label: string; note?: string }[];
  defaultModel: string;
}

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful save so the parent can refresh its "configured?" state. */
  onSaved?: () => void;
}

type TestResult =
  | { state: "idle" }
  | { state: "testing" }
  | { state: "success" }
  | { state: "error"; message: string };

export function SettingsPanel({ open, onClose, onSaved }: SettingsPanelProps) {
  const [settings, setSettings] = useState<LlmSettings | null>(null);
  const [loading, setLoading] = useState(false);

  // Local form state — separate from `settings` so we only persist on Save.
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [modelInput, setModelInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<TestResult>({ state: "idle" });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/llm", { credentials: "include" });
      if (!res.ok) return;
      const data = (await res.json()) as LlmSettings;
      setSettings(data);
      setModelInput(data.model);
      // Leave apiKeyInput empty — saving an empty string is interpreted as
      // "keep current key" on the server.
      setApiKeyInput("");
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    refresh().finally(() => setLoading(false));
    setTestResult({ state: "idle" });
  }, [open, refresh]);

  const handleTest = async () => {
    setTestResult({ state: "testing" });
    try {
      const res = await fetch("/api/settings/llm/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          apiKey: apiKeyInput || null,
          model: modelInput,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setTestResult({ state: "success" });
      } else {
        setTestResult({ state: "error", message: json.error ?? "Test failed" });
      }
    } catch (err) {
      setTestResult({
        state: "error",
        message: err instanceof Error ? err.message : "Test failed",
      });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const body: Record<string, string> = { model: modelInput };
      // Only send apiKey if the user actually typed something new — otherwise
      // the server keeps the existing key.
      if (apiKeyInput.trim()) body.apiKey = apiKeyInput.trim();
      const res = await fetch("/api/settings/llm", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setSavedAt(Date.now());
        setApiKeyInput("");
        await refresh();
        onSaved?.();
      }
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-zinc-900/20 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      <div className="fixed top-0 right-0 h-[100dvh] w-full sm:w-[440px] bg-white border-l border-zinc-200 z-50 shadow-2xl flex flex-col">
        <div className="h-14 border-b border-zinc-200 flex items-center justify-between px-5">
          <h2 className="text-[15px] font-semibold text-zinc-900">Settings</h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-900 text-2xl leading-none w-7 h-7 flex items-center justify-center rounded hover:bg-zinc-100 transition"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {loading && <p className="text-zinc-400 text-sm">Loading…</p>}

          {!loading && settings && (
            <section className="space-y-4">
              <div>
                <h3 className="text-[13px] font-semibold text-zinc-900">
                  Language model
                </h3>
                <p className="text-[11px] text-zinc-500 leading-relaxed mt-1">
                  Memory Map uses Claude for chat, auto-organizing incoming
                  memories into pages, and summarizing connections. Your API
                  key is stored locally in Memory Map's database and never
                  sent anywhere except directly to Anthropic.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[11px] font-medium text-zinc-700">
                  Provider
                </label>
                <div className="text-[12px] text-zinc-900 px-2.5 py-1.5 rounded-md border border-zinc-200 bg-zinc-50">
                  Anthropic (Claude)
                </div>
                <p className="text-[10px] text-zinc-400">
                  Support for other providers may be added in a future release.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[11px] font-medium text-zinc-700">
                  API key
                  {settings.hasApiKey && (
                    <span className="ml-2 text-zinc-400 font-normal">
                      (current: {settings.apiKeyPreview ?? "saved"}
                      {settings.source === "env" && ", from env var"})
                    </span>
                  )}
                </label>
                <div className="flex gap-2">
                  <input
                    type={showKey ? "text" : "password"}
                    value={apiKeyInput}
                    onChange={(e) => {
                      setApiKeyInput(e.target.value);
                      setTestResult({ state: "idle" });
                    }}
                    placeholder={
                      settings.hasApiKey
                        ? "Paste a new key to replace the current one"
                        : "sk-ant-…"
                    }
                    className="flex-1 px-2.5 py-1.5 text-xs font-mono rounded-md border border-zinc-200 bg-white text-zinc-900 focus:outline-none focus:border-zinc-400 transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((s) => !s)}
                    className="px-2.5 py-1.5 text-[11px] rounded-md border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 transition"
                  >
                    {showKey ? "Hide" : "Show"}
                  </button>
                </div>
                <p className="text-[10px] text-zinc-500 leading-relaxed">
                  Get one at{" "}
                  <a
                    href="https://console.anthropic.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-zinc-700 underline hover:text-zinc-900"
                  >
                    console.anthropic.com
                  </a>
                  . Leave blank to keep the current key.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[11px] font-medium text-zinc-700">
                  Model
                </label>
                <select
                  value={modelInput}
                  onChange={(e) => {
                    setModelInput(e.target.value);
                    setTestResult({ state: "idle" });
                  }}
                  className="w-full px-2.5 py-1.5 text-xs rounded-md border border-zinc-200 bg-white text-zinc-900 focus:outline-none focus:border-zinc-400 transition"
                >
                  {settings.availableModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                      {m.note ? ` — ${m.note}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={handleTest}
                  disabled={
                    testResult.state === "testing" ||
                    (!settings.hasApiKey && !apiKeyInput.trim())
                  }
                  className="px-3 py-1.5 text-xs font-medium rounded-md border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 hover:border-zinc-300 disabled:opacity-50 transition"
                >
                  {testResult.state === "testing" ? "Testing…" : "Test connection"}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-50 transition"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                {savedAt && Date.now() - savedAt < 3000 && (
                  <span className="text-[10px] text-emerald-600">Saved</span>
                )}
              </div>

              {testResult.state === "success" && (
                <div className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2.5 py-1.5">
                  ✓ Connection works. You can save now.
                </div>
              )}
              {testResult.state === "error" && (
                <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-md px-2.5 py-2 break-words">
                  <div className="font-medium mb-0.5">Connection failed</div>
                  <div className="font-mono text-[10px] opacity-90">
                    {testResult.message}
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </>
  );
}
