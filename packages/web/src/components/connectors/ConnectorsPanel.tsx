import { useEffect, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  ConnectorRecord,
  ConnectorTypeInfo,
  ConfigField,
} from "@memory-map/shared";
import { MemoryBrowser } from "./MemoryBrowser.js";

interface ConnectorsPanelProps {
  open: boolean;
  onClose: () => void;
}

export function ConnectorsPanel({ open, onClose }: ConnectorsPanelProps) {
  const [connectors, setConnectors] = useState<ConnectorRecord[]>([]);
  const [typeInfo, setTypeInfo] = useState<Record<string, ConnectorTypeInfo>>({});
  const [loading, setLoading] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [memoryBrowserOpen, setMemoryBrowserOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [conns, types] = await Promise.all([
        fetch("/api/connectors").then((r) => r.json()),
        fetch("/api/connectors/types").then((r) => r.json()),
      ]);
      if (Array.isArray(conns)) setConnectors(conns);
      if (Array.isArray(types)) {
        const map: Record<string, ConnectorTypeInfo> = {};
        for (const t of types) map[t.type] = t;
        setTypeInfo(map);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (open) {
      setLoading(true);
      refresh().finally(() => setLoading(false));
    }
  }, [open, refresh]);

  const toggleEnabled = async (c: ConnectorRecord) => {
    await fetch(`/api/connectors/${c.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !c.enabled }),
    });
    refresh();
  };

  const triggerSync = async (c: ConnectorRecord) => {
    setSyncingId(c.id);
    const startedAt = c.lastSyncAt;
    try {
      const res = await fetch(`/api/connectors/${c.id}/sync`, { method: "POST" });
      if (!res.ok) {
        // Surface immediate errors (e.g. "already running")
        const json = await res.json();
        alert(json.detail ?? json.error ?? "Sync failed to start");
        return;
      }
      // Sync runs in the background. Poll until lastSyncAt changes
      // or we hit a max wait of 5 minutes.
      const pollDeadline = Date.now() + 5 * 60 * 1000;
      while (Date.now() < pollDeadline) {
        await new Promise((r) => setTimeout(r, 2500));
        const cur = await fetch("/api/connectors").then((r) => r.json());
        if (Array.isArray(cur)) {
          setConnectors(cur);
          const updated = cur.find((x: ConnectorRecord) => x.id === c.id);
          if (updated && updated.lastSyncAt !== startedAt) {
            // Sync finished (success or error)
            break;
          }
        }
      }
    } finally {
      setSyncingId(null);
      refresh();
    }
  };

  const saveConfig = async (c: ConnectorRecord, config: Record<string, unknown>) => {
    await fetch(`/api/connectors/${c.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config }),
    });
    refresh();
  };

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-zinc-900/20 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      <div className="fixed top-0 right-0 h-full w-[440px] bg-white border-l border-zinc-200 z-50 shadow-2xl flex flex-col">
        <div className="h-14 border-b border-zinc-200 flex items-center justify-between px-5">
          <h2 className="text-[15px] font-semibold text-zinc-900">Connectors</h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-900 text-2xl leading-none w-7 h-7 flex items-center justify-center rounded hover:bg-zinc-100 transition"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {loading && <p className="text-zinc-400 text-sm">Loading…</p>}
          {!loading && connectors.length === 0 && (
            <p className="text-zinc-400 text-sm">No connectors registered.</p>
          )}
          {connectors.map((c) => (
            <ConnectorCard
              key={c.id}
              connector={c}
              info={typeInfo[c.type]}
              syncing={syncingId === c.id}
              expanded={expandedId === c.id}
              onToggleExpand={() =>
                setExpandedId(expandedId === c.id ? null : c.id)
              }
              onToggle={() => toggleEnabled(c)}
              onSync={() => triggerSync(c)}
              onSaveConfig={(config) => saveConfig(c, config)}
              onBrowseMemories={
                c.type === "screenpipe"
                  ? () => setMemoryBrowserOpen(true)
                  : undefined
              }
            />
          ))}
        </div>
      </div>

      <MemoryBrowser
        open={memoryBrowserOpen}
        onClose={() => setMemoryBrowserOpen(false)}
      />
    </>
  );
}

function ConnectorCard({
  connector,
  info,
  syncing,
  expanded,
  onToggleExpand,
  onToggle,
  onSync,
  onSaveConfig,
  onBrowseMemories,
}: {
  connector: ConnectorRecord;
  info: ConnectorTypeInfo | undefined;
  syncing: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggle: () => void;
  onSync: () => void;
  onSaveConfig: (config: Record<string, unknown>) => void;
  onBrowseMemories?: () => void;
}) {
  const lastSync = connector.lastSyncAt ? formatRelative(connector.lastSyncAt) : "never";

  return (
    <div className="rounded-lg border border-zinc-200 bg-white overflow-hidden">
      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-medium text-zinc-900 text-sm">{connector.name}</h3>
            <p className="text-xs text-zinc-500 mt-0.5">{connector.type}</p>
          </div>
          <button
            onClick={onToggle}
            className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
              connector.enabled ? "bg-zinc-900" : "bg-zinc-200"
            }`}
            aria-label={connector.enabled ? "Disable" : "Enable"}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                connector.enabled ? "translate-x-4" : ""
              }`}
            />
          </button>
        </div>

        <div className="text-xs text-zinc-500 space-y-1">
          <div>
            Last sync: <span className="text-zinc-700 tabular-nums">{lastSync}</span>
          </div>
          {connector.lastError && (
            <div className="text-red-600 text-xs break-words">
              Error: {connector.lastError}
            </div>
          )}
        </div>

        <div className="flex gap-2 flex-wrap">
          <button
            onClick={onSync}
            disabled={syncing}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 hover:border-zinc-300 disabled:opacity-50 transition"
          >
            {syncing ? "Syncing…" : "Sync now"}
          </button>
          {info && info.configSchema.length > 0 && (
            <button
              onClick={onToggleExpand}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 hover:border-zinc-300 transition"
            >
              {expanded ? "Hide settings" : "Configure"}
            </button>
          )}
          {onBrowseMemories && (
            <button
              onClick={onBrowseMemories}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 hover:border-zinc-300 transition"
            >
              Browse memories
            </button>
          )}
        </div>
      </div>

      {expanded && info && (
        <div className="border-t border-zinc-200 bg-zinc-50/60 p-4 space-y-4">
          {info.setupInstructions && (
            <div className="prose-mm text-xs text-zinc-700 max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {info.setupInstructions}
              </ReactMarkdown>
            </div>
          )}
          <ConfigForm
            schema={info.configSchema}
            initial={connector.config}
            onSave={onSaveConfig}
          />
          {connector.type === "google-drive" && (
            <GoogleDriveConnect connector={connector} />
          )}
        </div>
      )}
    </div>
  );
}

function GoogleDriveConnect({ connector }: { connector: ConnectorRecord }) {
  const cfg = connector.config as {
    authMode?: string;
    clientId?: string;
    clientSecret?: string;
    serviceAccountKey?: string;
  };

  // Service account mode doesn't need OAuth — hide the connect widget
  if (cfg.authMode === "service_account") {
    const hasKey = Boolean(cfg.serviceAccountKey && cfg.serviceAccountKey.trim());
    return (
      <div className="rounded-md border border-zinc-200 bg-white p-3 text-xs text-zinc-600">
        {hasKey
          ? "Service account key saved. Click Sync now to start importing."
          : "Paste a service account JSON key above and save."}
      </div>
    );
  }

  const isConnected = Boolean(
    (connector.state as Record<string, unknown>)?.refreshToken
  );
  const canConnect = Boolean(cfg.clientId && cfg.clientSecret);

  const handleConnect = () => {
    // Open the OAuth start URL in a new tab. The server redirects to Google,
    // Google redirects back to the server's callback, and the result page
    // self-closes.
    window.open("/api/oauth/start/google-drive", "_blank");
  };

  const handleDisconnect = async () => {
    await fetch("/api/oauth/disconnect/google-drive", { method: "POST" });
    window.location.reload();
  };

  return (
    <div className="rounded-md border border-zinc-200 bg-white p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-zinc-700">Google account</p>
          <p className="text-[10px] text-zinc-500 mt-0.5">
            {isConnected ? "Connected" : "Not connected"}
          </p>
        </div>
        {isConnected ? (
          <button
            onClick={handleDisconnect}
            className="text-xs px-3 py-1.5 rounded-md border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 transition"
          >
            Disconnect
          </button>
        ) : (
          <button
            onClick={handleConnect}
            disabled={!canConnect}
            className="text-xs px-3 py-1.5 rounded-md bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition"
            title={canConnect ? "" : "Save Client ID and Secret first"}
          >
            Connect with Google
          </button>
        )}
      </div>
      {!canConnect && (
        <p className="text-[10px] text-amber-700">
          Save Client ID and Client Secret first, then click Connect.
        </p>
      )}
    </div>
  );
}

function ConfigForm({
  schema,
  initial,
  onSave,
}: {
  schema: ConfigField[];
  initial: Record<string, unknown>;
  onSave: (config: Record<string, unknown>) => void;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(() => ({
    ...initial,
  }));
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const setValue = (key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(values);
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  };

  // Filter fields by their showWhen condition
  const visibleSchema = schema.filter((field) => {
    if (!field.showWhen) return true;
    return values[field.showWhen.key] === field.showWhen.equals;
  });

  return (
    <div className="space-y-3">
      {visibleSchema.map((field) => (
        <div key={field.key} className="space-y-1">
          <label className="block text-[11px] font-medium text-zinc-700">
            {field.label}
            {field.required && <span className="text-red-500 ml-0.5">*</span>}
          </label>
          {field.description && (
            <p className="text-[10px] text-zinc-500 leading-snug">
              {field.description}
            </p>
          )}
          {field.type === "boolean" ? (
            <button
              type="button"
              onClick={() => setValue(field.key, !values[field.key])}
              className={`relative w-9 h-5 rounded-full transition-colors ${
                values[field.key] ? "bg-zinc-900" : "bg-zinc-300"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                  values[field.key] ? "translate-x-4" : ""
                }`}
              />
            </button>
          ) : field.type === "select" ? (
            <select
              value={String(values[field.key] ?? field.default ?? "")}
              onChange={(e) => setValue(field.key, e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-zinc-200 bg-white text-zinc-900 focus:outline-none focus:border-zinc-400 transition"
            >
              {(field.options ?? []).map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : field.type === "textarea" ? (
            <textarea
              value={String(values[field.key] ?? "")}
              placeholder={field.placeholder}
              onChange={(e) => setValue(field.key, e.target.value)}
              rows={6}
              className="w-full px-2.5 py-1.5 text-xs font-mono rounded-md border border-zinc-200 bg-white text-zinc-900 focus:outline-none focus:border-zinc-400 transition resize-y"
            />
          ) : (
            <input
              type={
                field.type === "password"
                  ? "password"
                  : field.type === "number"
                    ? "number"
                    : "text"
              }
              value={String(values[field.key] ?? "")}
              placeholder={field.placeholder}
              onChange={(e) => {
                const v =
                  field.type === "number"
                    ? Number(e.target.value)
                    : e.target.value;
                setValue(field.key, v);
              }}
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-zinc-200 bg-white text-zinc-900 focus:outline-none focus:border-zinc-400 transition"
            />
          )}
        </div>
      ))}

      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-50 transition"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
        {savedAt && Date.now() - savedAt < 3000 && (
          <span className="text-[10px] text-emerald-600">Saved</span>
        )}
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
