import { useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { ChatPanel } from "./components/chat/ChatPanel.js";
import { GraphCanvas } from "./components/graph/GraphCanvas.js";
import { ConnectorsPanel } from "./components/connectors/ConnectorsPanel.js";
import { PageViewer } from "./components/pages/PageViewer.js";
import { useWebSocket } from "./hooks/useWebSocket.js";
import { useGraphStore } from "./hooks/useGraph.js";
import { useIsMobile } from "./hooks/useMediaQuery.js";

type MobileTab = "chat" | "graph" | "page";

export function App() {
  useWebSocket();
  const { nodes, edges } = useGraphStore();
  const isMobile = useIsMobile();
  const [connectorsOpen, setConnectorsOpen] = useState(false);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [pageViewOpen, setPageViewOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>("graph");

  const openPage = (id: string) => {
    setActivePageId(id);
    setPageViewOpen(true);
    if (isMobile) setMobileTab("page");
  };
  const closePage = () => {
    setPageViewOpen(false);
    if (isMobile && mobileTab === "page") setMobileTab("graph");
  };

  return (
    <div className="h-[100dvh] flex flex-col bg-white text-zinc-900 overflow-hidden">
      <header className="h-12 sm:h-14 border-b border-zinc-200 flex items-center justify-between px-3 sm:px-5 bg-white flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-md bg-zinc-900 flex items-center justify-center flex-shrink-0">
            <div className="w-2 h-2 rounded-sm bg-white" />
          </div>
          <h1 className="text-[15px] font-semibold tracking-tight truncate">
            Memory Map
          </h1>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="hidden sm:block text-xs text-zinc-500 tabular-nums">
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

      {isMobile ? (
        <>
          <main className="flex-1 overflow-hidden relative">
            <div
              className={`absolute inset-0 ${mobileTab === "chat" ? "" : "hidden"}`}
            >
              <ChatPanel onOpenPage={openPage} />
            </div>
            <div
              className={`absolute inset-0 ${mobileTab === "graph" ? "" : "hidden"}`}
            >
              <GraphCanvas onNodeClick={openPage} />
            </div>
            {pageViewOpen && (
              <div
                className={`absolute inset-0 ${mobileTab === "page" ? "" : "hidden"}`}
              >
                <PageViewer
                  pageId={activePageId}
                  onClose={closePage}
                  onNavigate={openPage}
                />
              </div>
            )}
          </main>
          <nav className="border-t border-zinc-200 bg-white flex items-stretch h-14 flex-shrink-0">
            <MobileTabButton
              label="Chat"
              active={mobileTab === "chat"}
              onClick={() => setMobileTab("chat")}
            />
            <MobileTabButton
              label="Graph"
              active={mobileTab === "graph"}
              onClick={() => setMobileTab("graph")}
            />
            <MobileTabButton
              label="Page"
              active={mobileTab === "page"}
              disabled={!pageViewOpen}
              onClick={() => pageViewOpen && setMobileTab("page")}
            />
          </nav>
        </>
      ) : (
        <PanelGroup
          key={pageViewOpen ? "with-page" : "no-page"}
          direction="horizontal"
          className="flex-1"
        >
          <Panel defaultSize={pageViewOpen ? 28 : 38} minSize={20}>
            <ChatPanel onOpenPage={openPage} />
          </Panel>
          <PanelResizeHandle className="w-px bg-zinc-200 hover:bg-zinc-300 transition-colors data-[resize-handle-state=drag]:bg-zinc-900" />
          <Panel defaultSize={pageViewOpen ? 42 : 62} minSize={25}>
            <GraphCanvas onNodeClick={openPage} />
          </Panel>
          {pageViewOpen && (
            <>
              <PanelResizeHandle className="w-px bg-zinc-200 hover:bg-zinc-300 transition-colors data-[resize-handle-state=drag]:bg-zinc-900" />
              <Panel defaultSize={30} minSize={20}>
                <PageViewer
                  pageId={activePageId}
                  onClose={closePage}
                  onNavigate={openPage}
                />
              </Panel>
            </>
          )}
        </PanelGroup>
      )}
    </div>
  );
}

function MobileTabButton({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 flex items-center justify-center text-[13px] font-medium transition ${
        active
          ? "text-zinc-900 border-t-2 border-zinc-900"
          : disabled
            ? "text-zinc-300"
            : "text-zinc-500 hover:text-zinc-900"
      }`}
    >
      {label}
    </button>
  );
}
