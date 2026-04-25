import { useState, useEffect, useCallback } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { ChatPanel } from "./components/chat/ChatPanel.js";
import { GraphCanvas } from "./components/graph/GraphCanvas.js";
import { ConnectorsPanel } from "./components/connectors/ConnectorsPanel.js";
import { PageViewer } from "./components/pages/PageViewer.js";
import { LogPanel } from "./components/log/LogPanel.js";
import { LintPanel } from "./components/log/LintPanel.js";
import { SettingsPanel } from "./components/settings/SettingsPanel.js";
import { ImportPanel } from "./components/files/ImportPanel.js";
import { useWebSocket } from "./hooks/useWebSocket.js";
import { useGraphStore } from "./hooks/useGraph.js";
import { useIsMobile } from "./hooks/useMediaQuery.js";
import { LoginScreen } from "./components/auth/LoginScreen.js";

type MobileTab = "chat" | "graph" | "page";

type AuthState = "checking" | "authed" | "unauthed";

export function App() {
  const [authState, setAuthState] = useState<AuthState>("checking");

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch("/api/auth/check", { credentials: "include" });
        const json = await res.json().catch(() => ({ authed: false }));
        if (cancelled) return;
        setAuthState(json.authed ? "authed" : "unauthed");
      } catch {
        if (!cancelled) setAuthState("unauthed");
      }
    };
    check();
    return () => {
      cancelled = true;
    };
  }, []);

  if (authState === "checking") {
    return <div className="h-[100dvh] bg-white" />;
  }
  if (authState === "unauthed") {
    return <LoginScreen onAuthed={() => setAuthState("authed")} />;
  }
  return <AppInner />;
}

function AppInner() {
  useWebSocket();
  const { nodes, edges, setActivePageId: setGraphActivePageId } = useGraphStore();
  const isMobile = useIsMobile();
  const [connectorsOpen, setConnectorsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [llmConfigured, setLlmConfigured] = useState<boolean | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [lintOpen, setLintOpen] = useState(false);

  // Check LLM config state on load so we can pulse the Settings button and
  // show a banner when the user hasn't added a key yet.
  const refreshLlmStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/llm", { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setLlmConfigured(Boolean(data.hasApiKey));
    } catch {
      // leave as-is
    }
  }, []);

  useEffect(() => {
    refreshLlmStatus();
  }, [refreshLlmStatus]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [pageViewOpen, setPageViewOpen] = useState(false);
  const [draftMode, setDraftMode] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>("graph");

  // Mirror the local activePageId into the graph store so the canvas can
  // highlight the open page in addition to whatever the chat surfaced.
  // Clear the store value when the page panel is closed.
  useEffect(() => {
    setGraphActivePageId(pageViewOpen ? activePageId : null);
  }, [activePageId, pageViewOpen, setGraphActivePageId]);

  const openPage = (id: string) => {
    setActivePageId(id);
    setDraftMode(false);
    setPageViewOpen(true);
    if (isMobile) setMobileTab("page");
  };
  const newPage = () => {
    setActivePageId(null);
    setDraftMode(true);
    setPageViewOpen(true);
    if (isMobile) setMobileTab("page");
  };
  const onPageCreated = (id: string) => {
    setDraftMode(false);
    setActivePageId(id);
  };
  const closePage = () => {
    setPageViewOpen(false);
    setDraftMode(false);
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
            onClick={newPage}
            className="text-xs px-3 py-1.5 rounded-md border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 hover:border-zinc-300 transition"
            title="Create a new page"
          >
            + New
          </button>
          <button
            onClick={() => setImportOpen(true)}
            className="text-xs px-3 py-1.5 rounded-md border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 hover:border-zinc-300 transition"
            title="Import files (text or PDF)"
          >
            Import
          </button>
          <button
            onClick={() => setLintOpen(true)}
            className="hidden sm:inline-block text-xs px-3 py-1.5 rounded-md border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 hover:border-zinc-300 transition"
            title="Run a health check on the graph"
          >
            Lint
          </button>
          <button
            onClick={() => setLogOpen(true)}
            className="hidden sm:inline-block text-xs px-3 py-1.5 rounded-md border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 hover:border-zinc-300 transition"
            title="Recent activity"
          >
            Log
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className={`relative text-xs px-3 py-1.5 rounded-md border transition ${
              llmConfigured === false
                ? "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
                : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 hover:border-zinc-300"
            }`}
            title={
              llmConfigured === false
                ? "No API key configured — click to set one up"
                : "Settings"
            }
          >
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true">⚙</span>
              <span>Settings</span>
              {llmConfigured === false && (
                <span className="ml-0.5 w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              )}
            </span>
          </button>
          <button
            onClick={() => setConnectorsOpen(true)}
            className="text-xs px-3 py-1.5 rounded-md border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 hover:border-zinc-300 transition"
          >
            Connectors
          </button>
        </div>
      </header>

      <ConnectorsPanel open={connectorsOpen} onClose={() => setConnectorsOpen(false)} />
      <ImportPanel open={importOpen} onClose={() => setImportOpen(false)} />
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={refreshLlmStatus}
      />
      <LogPanel
        open={logOpen}
        onClose={() => setLogOpen(false)}
        onOpenPage={(id) => {
          openPage(id);
          setLogOpen(false);
        }}
      />
      <LintPanel
        open={lintOpen}
        onClose={() => setLintOpen(false)}
        onOpenPage={(id) => {
          openPage(id);
          setLintOpen(false);
        }}
      />

      {isMobile ? (
        <>
          <main className="flex-1 overflow-hidden relative">
            <div
              className={`absolute inset-0 ${mobileTab === "chat" ? "" : "hidden"}`}
            >
              <ChatPanel
                onOpenPage={openPage}
                llmConfigured={llmConfigured}
                onOpenSettings={() => setSettingsOpen(true)}
              />
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
                  draftMode={draftMode}
                  onClose={closePage}
                  onNavigate={openPage}
                  onCreated={onPageCreated}
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
            <ChatPanel
                onOpenPage={openPage}
                llmConfigured={llmConfigured}
                onOpenSettings={() => setSettingsOpen(true)}
              />
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
                  draftMode={draftMode}
                  onClose={closePage}
                  onNavigate={openPage}
                  onCreated={onPageCreated}
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
