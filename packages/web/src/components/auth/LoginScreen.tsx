import { useState, type FormEvent } from "react";

interface LoginScreenProps {
  onAuthed: () => void;
}

export function LoginScreen({ onAuthed }: LoginScreenProps) {
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const key = apiKey.trim();
    if (!key) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ apiKey: key }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error) {
        setError(json.error ?? "Login failed");
        return;
      }
      onAuthed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="h-[100dvh] flex items-center justify-center bg-white text-zinc-900 px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-7 h-7 rounded-md bg-zinc-900 flex items-center justify-center">
            <div className="w-2.5 h-2.5 rounded-sm bg-white" />
          </div>
          <h1 className="text-[17px] font-semibold tracking-tight">Memory Map</h1>
        </div>

        <h2 className="text-[15px] font-medium text-zinc-900 mb-1">
          Enter your API key
        </h2>
        <p className="text-[12px] text-zinc-500 mb-5 leading-relaxed">
          Memory Map generated a key for you on first run. Look in your server
          terminal for the banner that begins{" "}
          <code className="text-[11px] bg-zinc-100 px-1 py-0.5 rounded">
            Memory Map: generated new credentials
          </code>
          , or read it from{" "}
          <code className="text-[11px] bg-zinc-100 px-1 py-0.5 rounded">
            data/credentials.json
          </code>
          . You'll only need to do this once per browser.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoFocus
            placeholder="paste API key…"
            className="w-full px-3 py-2 text-[13px] font-mono rounded-md border border-zinc-200 focus:border-zinc-900 focus:outline-none transition"
          />
          {error && (
            <p className="text-[12px] text-red-600">{error}</p>
          )}
          <button
            type="submit"
            disabled={submitting || !apiKey.trim()}
            className="w-full px-3 py-2 text-[13px] font-medium rounded-md bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-50 transition"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="text-[10px] text-zinc-400 mt-6 leading-relaxed">
          Your session is stored in a signed, http-only cookie that lasts 90 days.
          Memory Map runs entirely on your machine — this key never leaves it.
        </p>
      </div>
    </div>
  );
}
