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
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />

      {/* Slide-out panel */}
      <div className="fixed top-0 right-0 h-full w-96 bg-gray-900 border-l border-gray-700 z-50 shadow-2xl flex flex-col">
        <div className="h-12 border-b border-gray-800 flex items-center justify-between px-4">
          <h2 className="text-lg font-semibold">Connectors</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-100 text-xl"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading && <p className="text-gray-500 text-sm">Loading...</p>}
          {!loading && connectors.length === 0 && (
            <p className="text-gray-500 text-sm">No connectors registered.</p>
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
  const lastSync = connector.lastSyncAt
    ? formatRelative(connector.lastSyncAt)
    : "never";

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-medium text-gray-100">{connector.name}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{connector.type}</p>
        </div>
        <button
          onClick={onToggle}
          className={`relative w-11 h-6 rounded-full transition-colors ${
            connector.enabled ? "bg-blue-600" : "bg-gray-600"
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
              connector.enabled ? "translate-x-5" : ""
            }`}
          />
        </button>
      </div>

      <div className="text-xs text-gray-400 space-y-1">
        <div>Last sync: <span className="text-gray-300">{lastSync}</span></div>
        {connector.lastError && (
          <div className="text-red-400">Error: {connector.lastError}</div>
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={onSync}
          disabled={syncing}
          className="px-3 py-1.5 text-xs rounded bg-gray-700 text-gray-200 hover:bg-gray-600 disabled:opacity-50"
        >
          {syncing ? "Syncing..." : "Sync now"}
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
