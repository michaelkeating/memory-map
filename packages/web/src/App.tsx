import { useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { ChatPanel } from "./components/chat/ChatPanel.js";
import { GraphCanvas } from "./components/graph/GraphCanvas.js";
import { ConnectorsPanel } from "./components/connectors/ConnectorsPanel.js";
import { PageViewer } from "./components/pages/PageViewer.js";
import { useWebSocket } from "./hooks/useWebSocket.js";
import { useGraphStore } from "./hooks/useGraph.js";

export function App() {
  useWebSocket();
  const { nodes, edges } = useGraphStore();
  const [connectorsOpen, setConnectorsOpen] = useState(false);
  const [activePageId, setActivePageId] = useState<string | null>(null);

  return (
    <div className="h-screen flex flex-col bg-white text-zinc-900">
      <header className="h-14 border-b border-zinc-200 flex items-center justify-between px-5 bg-white">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-zinc-900 flex items-center justify-center">
            <div className="w-2 h-2 rounded-sm bg-white" />
          </div>
          <h1 className="text-[15px] font-semibold tracking-tight">Memory Map</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-xs text-zinc-500 tabular-nums">
            {nodes.length} pages · {edges.length} connections
          </div>
          <button
            onClick={() => setConnectorsOpen(true)}
            className="text-xs px-3 py-1.5 rounded-md border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 hover:border-zinc-300 transition"
          >
            Connectors
          </button>
        </div>
      </header>

      <ConnectorsPanel open={connectorsOpen} onClose={() => setConnectorsOpen(false)} />
      <PageViewer pageId={activePageId} onClose={() => setActivePageId(null)} />

      <PanelGroup direction="horizontal" className="flex-1">
        <Panel defaultSize={42} minSize={25}>
          <ChatPanel />
        </Panel>
        <PanelResizeHandle className="w-px bg-zinc-200 hover:bg-zinc-300 transition-colors data-[resize-handle-state=drag]:bg-zinc-900" />
        <Panel defaultSize={58} minSize={25}>
          <GraphCanvas onNodeClick={(id) => setActivePageId(id)} />
        </Panel>
      </PanelGroup>
    </div>
  );
}
