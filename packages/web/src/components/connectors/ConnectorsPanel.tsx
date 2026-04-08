import { useEffect, useState, useCallback } from "react";
import type { ConnectorRecord } from "@memory-map/shared";

interface ConnectorsPanelProps {
  open: boolean;
  onClose: () => void;
}

export function ConnectorsPanel({ open, onClose }: ConnectorsPanelProps) {
  const [connectors, setConnectors] = useState<ConnectorRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/connectors");
      const data = await res.json();
      if (Array.isArray(data)) setConnectors(data);
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
    try {
      await fetch(`/api/connectors/${c.id}/sync`, { method: "POST" });
    } finally {
      setSyncingId(null);
      refresh();
    }
  };

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-zinc-900/20 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      <div className="fixed top-0 right-0 h-full w-[400px] bg-white border-l border-zinc-200 z-50 shadow-2xl flex flex-col">
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
              syncing={syncingId === c.id}
              onToggle={() => toggleEnabled(c)}
              onSync={() => triggerSync(c)}
            />
          ))}
        </div>
      </div>
    </>
  );
}

function ConnectorCard({
  connector,
  syncing,
  onToggle,
  onSync,
}: {
  connector: ConnectorRecord;
  syncing: boolean;
  onToggle: () => void;
  onSync: () => void;
}) {
  const lastSync = connector.lastSyncAt ? formatRelative(connector.lastSyncAt) : "never";

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 space-y-3 hover:border-zinc-300 transition">
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
          <div className="text-red-600 text-xs">Error: {connector.lastError}</div>
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={onSync}
          disabled={syncing}
          className="px-3 py-1.5 text-xs font-medium rounded-md border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 hover:border-zinc-300 disabled:opacity-50 transition"
        >
          {syncing ? "Syncing…" : "Sync now"}
        </button>
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
