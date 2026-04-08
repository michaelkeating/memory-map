import { useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { ChatPanel } from "./components/chat/ChatPanel.js";
import { GraphCanvas } from "./components/graph/GraphCanvas.js";
import { ConnectorsPanel } from "./components/connectors/ConnectorsPanel.js";
import { useWebSocket } from "./hooks/useWebSocket.js";
import { useGraphStore } from "./hooks/useGraph.js";

export function App() {
  useWebSocket();
  const { nodes, edges } = useGraphStore();
  const [connectorsOpen, setConnectorsOpen] = useState(false);

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-gray-100">
      <header className="h-12 border-b border-gray-800 flex items-center justify-between px-4">
        <h1 className="text-lg font-semibold tracking-tight">Memory Map</h1>
        <div className="flex items-center gap-4">
          <div className="text-xs text-gray-500">
            {nodes.length} pages &middot; {edges.length} connections
          </div>
          <button
            onClick={() => setConnectorsOpen(true)}
            className="text-xs px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200"
          >
            Connectors
          </button>
        </div>
      </header>
      <ConnectorsPanel open={connectorsOpen} onClose={() => setConnectorsOpen(false)} />
      <PanelGroup direction="horizontal" className="flex-1">
        <Panel defaultSize={45} minSize={25}>
          <ChatPanel />
        </Panel>
        <PanelResizeHandle className="w-1.5 bg-gray-800 hover:bg-blue-500 transition-colors" />
        <Panel defaultSize={55} minSize={25}>
          <GraphCanvas />
        </Panel>
      </PanelGroup>
    </div>
  );
}
