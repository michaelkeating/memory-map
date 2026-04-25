import type { LlmManager } from "./llm-manager.js";

/**
 * System prompt used when we ask Claude to extract a PDF to markdown.
 * Mirrors the one in api/files.ts — we keep the same wording so an
 * uploaded PDF and a PDF pulled from Google Drive produce equivalent
 * text for the auto-organizer to ingest.
 */
const PDF_EXTRACTION_SYSTEM =
  "You convert PDF documents into clean markdown for a personal knowledge graph.";

const PDF_EXTRACTION_PROMPT = `The attached PDF is being added to a personal knowledge graph. Extract its text content into clean markdown:

- Preserve headings, lists, and paragraphs
- Drop page numbers, running headers/footers, and obvious chrome
- Keep tables as markdown tables when reasonable
- Don't summarize — return the full content
- If the PDF is mostly images with no extractable text, return a one-sentence description of what it appears to be

Return only the markdown, no preamble.`;

/**
 * Ask Claude to extract the text content of a PDF as clean markdown.
 * Used by both the file upload route and any connector that fetches
 * PDFs (currently Google Drive). Keeps the single extraction prompt
 * in one place so uploaded and pulled PDFs behave identically.
 *
 * Throws if the LLM isn't configured or if the API call fails — the
 * caller should catch and surface something actionable.
 */
export async function extractPdfToMarkdown(
  llm: LlmManager,
  pdfBytes: Buffer,
  sourceHint?: string
): Promise<string> {
  if (!llm.isConfigured()) {
    throw new Error(
      "No LLM API key configured. Open Settings to add one before ingesting PDFs."
    );
  }

  const result = await llm.chat({
    system: PDF_EXTRACTION_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: pdfBytes.toString("base64"),
            },
          },
          {
            type: "text",
            text: sourceHint
              ? `${PDF_EXTRACTION_PROMPT}\n\n(Source: ${sourceHint})`
              : PDF_EXTRACTION_PROMPT,
          },
          // The SDK's content-block type is wider than what we need,
          // so cast to shut the type checker up. We know these two
          // blocks are valid for the Anthropic messages API.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any,
      },
    ],
    maxTokens: 8192,
  });

  return result.text.trim();
}
