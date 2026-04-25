import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import fastifyMultipart from "@fastify/multipart";
import type { AutoOrganizer } from "../llm/auto-organizer.js";
import type { LlmManager } from "../llm/llm-manager.js";
import { extractPdfToMarkdown } from "../llm/pdf-extract.js";
import type { GraphService } from "../engine/graph-service.js";
import type { WebSocketHub } from "../ws/hub.js";

/**
 * Supported upload extensions and the category we treat them as.
 *
 * "text"  → read as UTF-8 and pass straight to organizer.ingest().
 * "html"  → read as UTF-8, strip tags to a plain-text approximation first.
 * "pdf"   → send the bytes to Claude as a document content block, ask for
 *           a clean markdown extraction, then pass the extracted text
 *           through organizer.ingest() like any other text source.
 *
 * Anything not in this map is rejected with a friendly error so users
 * understand why their .docx didn't work.
 */
const SUPPORTED_EXTENSIONS: Record<string, "text" | "html" | "pdf"> = {
  md: "text",
  markdown: "text",
  txt: "text",
  csv: "text",
  tsv: "text",
  json: "text",
  yaml: "text",
  yml: "text",
  xml: "text",
  log: "text",
  srt: "text",
  vtt: "text",
  html: "html",
  htm: "html",
  pdf: "pdf",
};

const TEXT_MAX_BYTES = 1 * 1024 * 1024; // 1 MB
const PDF_MAX_BYTES = 32 * 1024 * 1024; // 32 MB

/**
 * Minimum characters of extracted text before we bother sending to the
 * organizer. Below this the organizer tends to decide there's nothing
 * worth creating a page from, so we short-circuit with a friendly error
 * instead of burning tokens.
 */
const MIN_INGEST_CHARS = 40;

interface UploadSuccess {
  ok: true;
  filename: string;
  sourceLabel: string;
  bytes: number;
  extractedChars: number;
  operations: {
    createdPages: number;
    updatedPages: number;
    createdAssociations: number;
    updatedAssociations: number;
  };
}

interface UploadFailure {
  ok: false;
  filename: string;
  error: string;
}

/**
 * Strip HTML tags for a rough plain-text view of an .html upload. We
 * keep this dumb-simple on purpose: Claude tolerates leftover markup,
 * but we save tokens by not sending every <div> and inline style.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot < 0) return "";
  return filename.slice(lastDot + 1).toLowerCase();
}

/**
 * Stable external id for an uploaded file: a SHA-256 of its bytes. This
 * makes re-uploading the same file a no-op on the source side — the
 * source store's `recordSource` upserts by (externalSource, externalId),
 * so you get one source row per distinct piece of content regardless of
 * filename.
 */
function hashBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function registerFileRoutes(
  app: FastifyInstance,
  organizer: AutoOrganizer,
  llm: LlmManager,
  graphService: GraphService,
  wsHub: WebSocketHub
) {
  // Multipart config: we accept one file per request (the client iterates
  // through a batch on its side, which gives per-file progress updates
  // and lets us fail individual files without tanking the whole batch).
  // fileSize is set generously to the PDF ceiling; we apply the
  // text-specific ceiling after we know the extension.
  await app.register(fastifyMultipart, {
    limits: {
      files: 1,
      fileSize: PDF_MAX_BYTES,
      fieldSize: 1024,
      fields: 4,
    },
  });

  app.post("/api/files/upload", async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.code(400).send({
        ok: false,
        filename: "",
        error: "No file uploaded. Send as multipart/form-data with field name 'file'.",
      } satisfies UploadFailure);
    }

    const filename = data.filename || "unnamed";
    const extension = getExtension(filename);
    const category = SUPPORTED_EXTENSIONS[extension];

    if (!category) {
      // Drain the stream so Fastify doesn't hang on a half-read request.
      await data.toBuffer().catch(() => undefined);
      return reply.code(400).send({
        ok: false,
        filename,
        error: `Unsupported file type ".${extension || "(none)"}". Supported: ${Object.keys(SUPPORTED_EXTENSIONS)
          .map((e) => `.${e}`)
          .join(", ")}.`,
      } satisfies UploadFailure);
    }

    // Read the entire file into memory. Fine for our size limits; if we
    // ever support much larger files we'd stream to a temp path instead.
    let bytes: Buffer;
    try {
      bytes = await data.toBuffer();
    } catch (err) {
      const isSizeError = err instanceof Error && /request file too large/i.test(err.message);
      return reply.code(isSizeError ? 413 : 500).send({
        ok: false,
        filename,
        error: isSizeError
          ? `File too large. PDFs up to 32 MB, text files up to 1 MB.`
          : `Could not read upload: ${err instanceof Error ? err.message : String(err)}`,
      } satisfies UploadFailure);
    }

    // Apply the text-specific ceiling now that we know the category.
    if (category !== "pdf" && bytes.length > TEXT_MAX_BYTES) {
      return reply.code(413).send({
        ok: false,
        filename,
        error: `Text file too large (${Math.round(bytes.length / 1024)} KB). Limit is 1 MB for text formats.`,
      } satisfies UploadFailure);
    }

    // Extract the text content we'll pass to the organizer.
    let extractedText: string;
    try {
      if (category === "text") {
        extractedText = bytes.toString("utf-8");
      } else if (category === "html") {
        extractedText = htmlToText(bytes.toString("utf-8"));
      } else {
        // PDF path — delegated to the shared extractor so uploads and
        // Google Drive PDFs use identical logic and prompt wording.
        extractedText = await extractPdfToMarkdown(llm, bytes, filename);
      }
    } catch (err) {
      return reply.code(500).send({
        ok: false,
        filename,
        error: `Extraction failed: ${err instanceof Error ? err.message : String(err)}`,
      } satisfies UploadFailure);
    }

    if (extractedText.length < MIN_INGEST_CHARS) {
      return reply.code(200).send({
        ok: false,
        filename,
        error: `Too little text extracted (${extractedText.length} chars). Skipping.`,
      } satisfies UploadFailure);
    }

    // Ingest through the same path connectors use. externalSource is
    // "upload" so future lookups / event logs can distinguish these.
    const externalId = hashBytes(bytes);
    const sourceLabel = `Upload / ${filename}`;

    let operations;
    try {
      operations = await organizer.ingest({
        externalSource: "upload",
        externalId,
        content: extractedText,
        sourceLabel,
        capturedAt: new Date().toISOString(),
        tags: ["upload", `upload:${category}`],
      });
    } catch (err) {
      // Log everything we have to the server console so future debugging
      // doesn't require a re-upload. The client only sees a cleaner one-
      // liner, but with enough detail to act on.
      const e = err as Error & { code?: string; cause?: unknown };
      console.error(
        `[upload] ingest failed for "${filename}":\n` +
          `  name=${e.name ?? "Error"}\n` +
          `  code=${e.code ?? "(none)"}\n` +
          `  message=${e.message ?? "(none)"}\n` +
          `  stack=${e.stack ?? "(no stack)"}`
      );

      // Build a human-friendly error string that always has the code and
      // message when they're available, so the client can show something
      // actionable instead of the bare "constraint failed".
      const bits: string[] = [];
      if (e.code) bits.push(`[${e.code}]`);
      bits.push(e.message || e.name || "Unknown ingest error");
      return reply.code(500).send({
        ok: false,
        filename,
        error: `Ingest failed: ${bits.join(" ")}`,
      } satisfies UploadFailure);
    }

    // Broadcast the fresh graph so any open clients see the new nodes
    // without needing to refresh. Matches what the connector-side routes
    // do after ingest.
    const graph = graphService.getFullGraph();
    wsHub.broadcast({ type: "graph:full", graph });

    const response: UploadSuccess = {
      ok: true,
      filename,
      sourceLabel,
      bytes: bytes.length,
      extractedChars: extractedText.length,
      operations: {
        createdPages: operations.createPages.length,
        updatedPages: operations.updatePages.length,
        createdAssociations: operations.createAssociations.length,
        updatedAssociations: operations.updateAssociations.length,
      },
    };
    return response;
  });
}
