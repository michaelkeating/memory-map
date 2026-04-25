import { useCallback, useRef, useState } from "react";

interface ImportPanelProps {
  open: boolean;
  onClose: () => void;
}

type FileStatus =
  | { state: "pending" }
  | { state: "uploading" }
  | { state: "done"; pagesCreated: number; pagesUpdated: number; extractedChars: number }
  | { state: "error"; message: string };

interface FileEntry {
  file: File;
  id: string;
  status: FileStatus;
}

/**
 * Extensions the server will accept. Kept in sync with
 * packages/server/src/api/files.ts's SUPPORTED_EXTENSIONS. The <input>
 * accept attribute uses these to pre-filter the native picker dialog;
 * the server is still the authoritative check.
 */
const ACCEPTED_EXTENSIONS = [
  ".md",
  ".markdown",
  ".txt",
  ".csv",
  ".tsv",
  ".json",
  ".yaml",
  ".yml",
  ".xml",
  ".log",
  ".srt",
  ".vtt",
  ".html",
  ".htm",
  ".pdf",
];

const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.join(",");

/**
 * Stable per-file key for React's list rendering. We can't use `file`
 * itself as a key (not a string) and `file.name` collides when the
 * user drops two files with the same name, so we generate a random id
 * at add time.
 */
function makeId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function ImportPanel({ open, onClose }: ImportPanelProps) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const list = Array.from(incoming).map<FileEntry>((file) => ({
      file,
      id: makeId(),
      status: { state: "pending" },
    }));
    setFiles((prev) => [...prev, ...list]);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      if (e.dataTransfer?.files?.length) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }, []);

  const handlePicked = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) {
        addFiles(e.target.files);
      }
      // Clear so the same file can be picked again later.
      if (inputRef.current) inputRef.current.value = "";
    },
    [addFiles]
  );

  const clearDone = () => {
    setFiles((prev) => prev.filter((f) => f.status.state !== "done"));
  };

  const uploadOne = async (entry: FileEntry): Promise<FileStatus> => {
    const form = new FormData();
    form.append("file", entry.file);
    try {
      const res = await fetch("/api/files/upload", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        return {
          state: "error",
          message: json.error ?? `HTTP ${res.status}`,
        };
      }
      return {
        state: "done",
        pagesCreated: json.operations?.createdPages ?? 0,
        pagesUpdated: json.operations?.updatedPages ?? 0,
        extractedChars: json.extractedChars ?? 0,
      };
    } catch (err) {
      return {
        state: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  };

  const runBatch = async () => {
    setBatchRunning(true);
    // Copy the list at start so we don't re-process files the user adds
    // mid-batch. Those will be picked up on the next run.
    const snapshot = files.filter((f) => f.status.state === "pending");
    for (const entry of snapshot) {
      setFiles((prev) =>
        prev.map((f) => (f.id === entry.id ? { ...f, status: { state: "uploading" } } : f))
      );
      const status = await uploadOne(entry);
      setFiles((prev) => prev.map((f) => (f.id === entry.id ? { ...f, status } : f)));
    }
    setBatchRunning(false);
  };

  const pendingCount = files.filter((f) => f.status.state === "pending").length;
  const doneCount = files.filter((f) => f.status.state === "done").length;
  const errorCount = files.filter((f) => f.status.state === "error").length;

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-zinc-900/20 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      <div className="fixed top-0 right-0 h-[100dvh] w-full sm:w-[480px] bg-white border-l border-zinc-200 z-50 shadow-2xl flex flex-col">
        <div className="h-14 border-b border-zinc-200 flex items-center justify-between px-5">
          <div>
            <h2 className="text-[15px] font-semibold text-zinc-900">Import files</h2>
            <p className="text-[10px] text-zinc-500 mt-0.5">
              Drop text files or PDFs to add them to your graph
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-900 text-2xl leading-none w-7 h-7 flex items-center justify-center rounded hover:bg-zinc-100 transition"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => inputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg px-5 py-10 text-center cursor-pointer transition ${
              dragActive
                ? "border-zinc-900 bg-zinc-50"
                : "border-zinc-300 bg-zinc-50/30 hover:bg-zinc-50 hover:border-zinc-400"
            }`}
          >
            <div className="text-[13px] font-medium text-zinc-900">
              {dragActive ? "Drop to add" : "Drag files here, or click to choose"}
            </div>
            <div className="text-[10px] text-zinc-500 mt-2 leading-relaxed">
              Accepted: .md, .txt, .csv, .tsv, .json, .yaml, .xml, .html, .log, .srt, .vtt, .pdf
              <br />
              Text files up to 1 MB each · PDFs up to 32 MB each
            </div>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPT_ATTR}
              onChange={handlePicked}
              className="hidden"
            />
          </div>

          {files.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[11px] text-zinc-500">
                  {files.length} file{files.length === 1 ? "" : "s"}
                  {pendingCount > 0 && ` · ${pendingCount} pending`}
                  {doneCount > 0 && ` · ${doneCount} done`}
                  {errorCount > 0 && (
                    <span className="text-red-600"> · {errorCount} failed</span>
                  )}
                </div>
                {doneCount > 0 && (
                  <button
                    onClick={clearDone}
                    className="text-[10px] text-zinc-500 hover:text-zinc-900 transition"
                  >
                    Clear completed
                  </button>
                )}
              </div>

              <ul className="space-y-1.5">
                {files.map((entry) => (
                  <li
                    key={entry.id}
                    className="rounded-md border border-zinc-200 bg-white px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-medium text-zinc-900 truncate">
                          {entry.file.name}
                        </div>
                        <div className="text-[10px] text-zinc-500 mt-0.5">
                          {formatBytes(entry.file.size)}
                          {entry.status.state === "done" && (
                            <>
                              {" · "}
                              {entry.status.pagesCreated} page
                              {entry.status.pagesCreated === 1 ? "" : "s"} created
                              {entry.status.pagesUpdated > 0 &&
                                `, ${entry.status.pagesUpdated} updated`}
                            </>
                          )}
                          {entry.status.state === "uploading" && " · uploading…"}
                        </div>
                        {entry.status.state === "error" && (
                          <div className="text-[10px] text-red-600 mt-1 break-words">
                            {entry.status.message}
                          </div>
                        )}
                      </div>
                      <div className="flex-shrink-0">
                        <StatusBadge status={entry.status} />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="border-t border-zinc-200 px-5 py-3 bg-white flex items-center justify-between flex-shrink-0">
          <div className="text-[10px] text-zinc-500">
            Each file becomes a source; the organizer decides what pages to create.
          </div>
          <button
            onClick={runBatch}
            disabled={pendingCount === 0 || batchRunning}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-50 transition"
          >
            {batchRunning
              ? "Processing…"
              : pendingCount === 0
                ? "Nothing to upload"
                : `Upload ${pendingCount} file${pendingCount === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </>
  );
}

function StatusBadge({ status }: { status: FileStatus }) {
  if (status.state === "pending") {
    return (
      <span className="inline-block text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500">
        Pending
      </span>
    );
  }
  if (status.state === "uploading") {
    return (
      <span className="inline-block text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">
        Uploading
      </span>
    );
  }
  if (status.state === "done") {
    return (
      <span className="inline-block text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">
        Done
      </span>
    );
  }
  return (
    <span className="inline-block text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-50 text-red-700">
      Failed
    </span>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
