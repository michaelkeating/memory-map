import { createSign } from "node:crypto";
import type { Connector, SyncResult, IngestFn } from "./types.js";
import type { ConnectorRecord, ConfigField } from "@memory-map/shared";
import type { LlmManager } from "../llm/llm-manager.js";
import { extractPdfToMarkdown } from "../llm/pdf-extract.js";

interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  createdTime: string;
  webViewLink?: string;
  owners?: Array<{ displayName: string; emailAddress: string }>;
}

interface DriveFileListResponse {
  kind: "drive#fileList";
  files: GoogleDriveFile[];
  nextPageToken?: string;
}

interface OAuthTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: "Bearer";
}

interface GoogleDriveState {
  refreshToken?: string;
  accessToken?: string;
  accessTokenExpiry?: number; // ms since epoch
  lastModifiedTime?: string;
  ingestedIds?: string[];
  totalIngested?: number;
  [key: string]: unknown;
}

interface GoogleDriveConfig {
  authMode: "oauth" | "service_account";
  // OAuth fields
  clientId: string;
  clientSecret: string;
  // Service account fields
  serviceAccountKey: string; // raw JSON of the service account key file
  // Common
  pollSeconds: number;
  maxFilesPerSync: number;
  /**
   * One or more Drive folder IDs (or full Drive folder URLs), separated
   * by newlines or commas. Each becomes a root for the recursive scan
   * (or a direct parent filter if recursion is disabled). Blank = search
   * everything the account can see.
   */
  folderFilters: string;
  recurseSubfolders: boolean;
  ingestHistorical: boolean;
}

const DEFAULT_CONFIG: GoogleDriveConfig = {
  authMode: "oauth",
  clientId: "",
  clientSecret: "",
  serviceAccountKey: "",
  pollSeconds: 1800,
  maxFilesPerSync: 25,
  folderFilters: "",
  recurseSubfolders: true,
  ingestHistorical: true,
};

/**
 * Cap on how many folders we'll walk when expanding a folder tree. Protects
 * against a typo or a huge shared root accidentally kicking off a massive
 * traversal. Sutro-scale teams should be well below this; a Google Workspace
 * "everything we've ever made" root could exceed it, and that's correct —
 * point the connector at something narrower.
 */
const MAX_DESCENDANT_FOLDERS = 500;

/**
 * Drive's `q=` parameter has a practical length limit around 8 KB. Folder
 * IDs are ~33 chars, plus quoting and " or " glue, so 80 folders per OR
 * clause keeps us comfortably under. If the descendant set is larger than
 * this we issue multiple list queries and merge the results.
 */
const FOLDERS_PER_QUERY = 80;

/**
 * Supported Drive file types, keyed by their Drive mimeType. Each entry
 * says how to turn that file type into markdown/text we can hand to the
 * auto-organizer.
 *
 *   export:  call Drive's /files/{id}/export endpoint with the given
 *            target mimeType and treat the response body as text.
 *   download: call /files/{id}?alt=media to get the raw bytes, then
 *            interpret them as UTF-8 text (HTML gets a rough tag strip).
 *   pdf:     download the raw bytes and hand them to Claude's native
 *            PDF document block for extraction.
 *
 * Ordering matters for the Drive query we build from this map — every
 * key here becomes a `mimeType='…'` clause in an OR chain. Keep the
 * list tight enough that Drive's q-length budget stays comfortable.
 */
interface FileTypeHandler {
  kind: "export" | "download" | "pdf";
  /** Target mimeType for Google Apps exports. Unused otherwise. */
  exportAs?: string;
  /** Short label used in the source_label field on ingestion. */
  label: string;
  /** When kind=download, how to interpret the bytes. Default "text". */
  downloadAs?: "text" | "html";
}

const SUPPORTED_MIME_TYPES: Record<string, FileTypeHandler> = {
  // Native Google Apps types → export to a text format
  "application/vnd.google-apps.document": {
    kind: "export",
    exportAs: "text/markdown",
    label: "Google Doc",
  },
  "application/vnd.google-apps.spreadsheet": {
    kind: "export",
    exportAs: "text/csv",
    label: "Google Sheet",
  },
  "application/vnd.google-apps.presentation": {
    kind: "export",
    exportAs: "text/plain",
    label: "Google Slides",
  },

  // PDFs — Claude native extraction
  "application/pdf": { kind: "pdf", label: "PDF" },

  // Plain-text-ish formats — download bytes, decode as UTF-8
  "text/plain": { kind: "download", label: "Text file" },
  "text/markdown": { kind: "download", label: "Markdown" },
  "text/x-markdown": { kind: "download", label: "Markdown" },
  "text/csv": { kind: "download", label: "CSV" },
  "text/tab-separated-values": { kind: "download", label: "TSV" },
  "application/json": { kind: "download", label: "JSON" },
  "application/yaml": { kind: "download", label: "YAML" },
  "text/yaml": { kind: "download", label: "YAML" },
  "application/xml": { kind: "download", label: "XML" },
  "text/xml": { kind: "download", label: "XML" },
  "text/html": { kind: "download", label: "HTML", downloadAs: "html" },
};

const SUPPORTED_MIME_LIST = Object.keys(SUPPORTED_MIME_TYPES);

interface ServiceAccountKey {
  type: "service_account";
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  token_uri: string;
}

export const GOOGLE_DRIVE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
];

export const GOOGLE_DRIVE_REDIRECT_PATH = "/api/oauth/callback/google-drive";

const CONFIG_SCHEMA: ConfigField[] = [
  {
    key: "authMode",
    label: "Authentication method",
    type: "select",
    default: "oauth",
    options: [
      { value: "oauth", label: "OAuth (browser sign-in)" },
      { value: "service_account", label: "Service account (for Advanced Protection)" },
    ],
    description:
      "OAuth uses a normal Google sign-in. Service account uses a robot identity that you share specific Drive folders with — required if your Google account has Advanced Protection enabled.",
  },
  {
    key: "clientId",
    label: "OAuth Client ID",
    type: "text",
    description: "From your Google Cloud OAuth 2.0 Client ID. Ends in .apps.googleusercontent.com.",
    placeholder: "...apps.googleusercontent.com",
    showWhen: { key: "authMode", equals: "oauth" },
  },
  {
    key: "clientSecret",
    label: "OAuth Client Secret",
    type: "password",
    description: "From your Google Cloud OAuth 2.0 Client. Starts with GOCSPX-.",
    placeholder: "GOCSPX-…",
    showWhen: { key: "authMode", equals: "oauth" },
  },
  {
    key: "serviceAccountKey",
    label: "Service account key JSON",
    type: "textarea",
    description:
      "Paste the entire JSON key file you downloaded from Google Cloud Console. Make sure to share Drive folders with the service account's client_email (shown in the JSON).",
    placeholder: '{\n  "type": "service_account",\n  "project_id": "...",\n  ...\n}',
    showWhen: { key: "authMode", equals: "service_account" },
  },
  {
    key: "folderFilters",
    label: "Folder IDs (optional)",
    type: "textarea",
    description:
      "Restrict imports to specific folders. Paste one per line (or separate with commas). Each entry can be a raw folder ID or a full Drive URL — Memory Map pulls the ID out of the URL automatically. Leave blank to search everything the account can see. Combine with the 'Include sub-folders' toggle below to walk each root recursively.",
    placeholder:
      "1AbcDef...\nhttps://drive.google.com/drive/folders/1XyzGhi...",
  },
  {
    key: "recurseSubfolders",
    label: "Include sub-folders",
    type: "boolean",
    default: true,
    description:
      "Walk the folder tree recursively. When on, Memory Map imports files from the selected folder and all of its descendants. Off matches the old behaviour (files directly in the selected folder only).",
  },
  {
    key: "maxFilesPerSync",
    label: "Max files per sync",
    type: "number",
    default: 25,
  },
  {
    key: "pollSeconds",
    label: "Poll interval (seconds)",
    type: "number",
    default: 1800,
  },
  {
    key: "ingestHistorical",
    label: "Ingest existing files on first sync",
    type: "boolean",
    default: true,
  },
];

const SETUP_INSTRUCTIONS = `Pick an authentication method below. Most people should use **OAuth**, but if your Google account has **Advanced Protection** enabled, OAuth flows for unverified apps are blocked — use **Service account** instead.

**OAuth setup:**

1. Visit [console.cloud.google.com](https://console.cloud.google.com/) and pick or create a project.
2. Enable the **Google Drive API** under "APIs & Services → Library".
3. Configure the **OAuth consent screen** ("APIs & Services → OAuth consent screen"). Pick "External", fill in the required fields, and add yourself as a Test user.
4. Create credentials: "APIs & Services → Credentials → + Create credentials → OAuth client ID". Choose **Web application**.
5. Add this redirect URI exactly: \`http://localhost:3001/api/oauth/callback/google-drive\`
6. Copy the **Client ID** and **Client Secret** into the fields below, click **Save settings**, then click **Connect with Google**.

**Service account setup (Advanced Protection):**

1. Visit [console.cloud.google.com](https://console.cloud.google.com/) and pick or create a project.
2. Enable the **Google Drive API**.
3. **APIs & Services → Credentials → + Create credentials → Service account.** Give it a name and create.
4. Click into the newly created service account → **Keys** tab → **Add key → Create new key → JSON**. A JSON file downloads.
5. Copy the value of \`client_email\` from the JSON — it looks like \`name@project.iam.gserviceaccount.com\`.
6. **In Google Drive**, open each folder or file you want to import. Click **Share** and add the service account's email as a **Viewer**. The service account can only see files you've explicitly shared with it.
7. Paste the **entire JSON contents** into the field below, click **Save settings**, then **Sync now**.`;

export class GoogleDriveConnector implements Connector {
  readonly type = "google-drive";
  readonly defaultName = "Google Drive";
  readonly defaultConfig = DEFAULT_CONFIG as unknown as Record<string, unknown>;
  readonly defaultPollSeconds = DEFAULT_CONFIG.pollSeconds;
  readonly configSchema = CONFIG_SCHEMA;
  readonly setupInstructions = SETUP_INSTRUCTIONS;

  /**
   * The PDF path needs to call Claude with a document content block,
   * so the connector holds a reference to the shared LlmManager. All
   * the other paths (native Google Apps exports, raw text download,
   * OAuth URL building) don't need it, which is why it's optional —
   * the OAuth route handlers construct a bare instance just to call
   * buildAuthUrl / exchangeCode / refreshAccessToken without caring
   * about the sync path.
   */
  constructor(private llm?: LlmManager) {}

  /**
   * Build the Google OAuth authorization URL. The frontend redirects
   * the user here when they click "Connect with Google".
   */
  buildAuthUrl(clientId: string, redirectUri: string, state: string): string {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GOOGLE_DRIVE_OAUTH_SCOPES.join(" "));
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent"); // force refresh token return
    url.searchParams.set("state", state);
    return url.toString();
  }

  /** Exchange an authorization code for tokens */
  async exchangeCode(
    code: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string
  ): Promise<OAuthTokenResponse> {
    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Token exchange failed: ${res.status} ${text.slice(0, 300)}`);
    }
    return (await res.json()) as OAuthTokenResponse;
  }

  /** Use the refresh token to get a fresh access token */
  async refreshAccessToken(
    refreshToken: string,
    clientId: string,
    clientSecret: string
  ): Promise<OAuthTokenResponse> {
    const body = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    });

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Token refresh failed: ${res.status} ${text.slice(0, 300)}`);
    }
    return (await res.json()) as OAuthTokenResponse;
  }

  // ─── Connector sync ──────────────────────────────────────────

  async sync(record: ConnectorRecord, ingestFn: IngestFn): Promise<SyncResult> {
    const config = { ...DEFAULT_CONFIG, ...(record.config as Partial<GoogleDriveConfig>) };
    const state = record.state as GoogleDriveState;

    // Get an access token, dispatching on auth mode
    let accessToken: string;
    if (config.authMode === "service_account") {
      if (!config.serviceAccountKey || config.serviceAccountKey.trim() === "") {
        throw new Error(
          "Service account key not configured. Paste the JSON key file contents in settings."
        );
      }
      let key: ServiceAccountKey;
      try {
        key = JSON.parse(config.serviceAccountKey) as ServiceAccountKey;
      } catch {
        throw new Error("Service account key is not valid JSON.");
      }
      if (!key.client_email || !key.private_key) {
        throw new Error("Service account JSON is missing client_email or private_key.");
      }
      accessToken = await this.ensureServiceAccountToken(state, key);
    } else {
      // OAuth mode
      if (!config.clientId || !config.clientSecret) {
        throw new Error(
          "Google OAuth client not configured. Add Client ID and Client Secret in settings."
        );
      }
      if (!state.refreshToken) {
        throw new Error(
          'Not connected to Google Drive yet. Click "Connect with Google" in settings.'
        );
      }
      accessToken = await this.ensureAccessToken(state, config);
    }

    // First sync: optionally skip historical
    const isFirstSync = !state.lastModifiedTime;
    if (isFirstSync && !config.ingestHistorical) {
      const latest = await this.listFiles(accessToken, config, undefined, 1);
      const cursor =
        latest.length > 0 ? latest[0].modifiedTime : new Date().toISOString();
      return {
        itemsFetched: 0,
        itemsIngested: 0,
        message: `First sync skipped historical files. Will ingest files modified after ${cursor}.`,
        newState: {
          ...state,
          accessToken,
          accessTokenExpiry: state.accessTokenExpiry,
          lastModifiedTime: cursor,
          ingestedIds: [],
        },
      };
    }

    // Fetch ingestible files modified since cursor
    const files = await this.listFiles(
      accessToken,
      config,
      state.lastModifiedTime,
      config.maxFilesPerSync
    );

    if (files.length === 0) {
      return {
        itemsFetched: 0,
        itemsIngested: 0,
        message: "No new or updated files",
        newState: {
          ...state,
          accessToken,
          accessTokenExpiry: state.accessTokenExpiry,
        },
      };
    }

    let ingested = 0;
    let newestModified = state.lastModifiedTime ?? "1970-01-01T00:00:00Z";
    const ingestedIds = new Set(state.ingestedIds ?? []);

    for (const file of files) {
      const handler = SUPPORTED_MIME_TYPES[file.mimeType];
      if (!handler) {
        // Shouldn't happen (we queried by these exact mime types) but
        // skip defensively rather than crash the whole batch.
        console.warn(
          `[google-drive] skipping ${file.name}: unexpected mimeType ${file.mimeType}`
        );
        continue;
      }

      try {
        const extracted = await this.fetchFileContent(accessToken, file, handler);
        const trimmed = extracted.trim();
        if (trimmed.length < 10) continue; // skip empty-ish files

        const ownerLine =
          file.owners && file.owners.length > 0
            ? `\n_Owner: ${file.owners[0].displayName}_\n`
            : "";

        const content = `# ${file.name}\n${ownerLine}\n${trimmed}`;

        await ingestFn({
          externalSource: "google-drive",
          externalId: file.id,
          content,
          sourceLabel: `Google Drive / ${file.name}`,
          capturedAt: file.modifiedTime,
          tags: ["google-drive", mimeToTag(file.mimeType)],
        });

        ingested++;
        ingestedIds.add(file.id);
        if (file.modifiedTime > newestModified) {
          newestModified = file.modifiedTime;
        }

        // Be polite to Google (and to Anthropic, for the PDF path)
        await this.sleep(300);
      } catch (err) {
        console.error(
          `[google-drive] file ${file.id} (${file.name}, ${file.mimeType}) failed:`,
          err
        );
        // Don't abort the whole batch on a single file error — move on
        // so other files in the same sync still get imported. The
        // connector runner surfaces the last error on the connector card.
        continue;
      }
    }

    return {
      itemsFetched: files.length,
      itemsIngested: ingested,
      message: `Ingested ${ingested} of ${files.length} files`,
      newState: {
        ...state,
        accessToken,
        accessTokenExpiry: state.accessTokenExpiry,
        lastModifiedTime: newestModified,
        ingestedIds: Array.from(ingestedIds).slice(-1000),
        totalIngested: (state.totalIngested ?? 0) + ingested,
      },
    };
  }

  /**
   * Fetch the contents of a single Drive file and return it as plain
   * markdown/text that the auto-organizer can ingest. Dispatches on the
   * file's Drive mimeType using SUPPORTED_MIME_TYPES:
   *
   *   - Native Google Apps types → Drive /export with the handler's
   *     target mimeType (markdown for Docs, CSV for Sheets, plain text
   *     for Slides).
   *   - PDFs → raw /alt=media download, then Claude's document content
   *     block via the shared pdf-extract helper.
   *   - Text-ish types → raw /alt=media download, decoded as UTF-8.
   *     HTML gets a rough tag strip so the token count doesn't balloon.
   */
  private async fetchFileContent(
    accessToken: string,
    file: GoogleDriveFile,
    handler: FileTypeHandler
  ): Promise<string> {
    if (handler.kind === "export") {
      return this.exportAsText(accessToken, file.id, handler.exportAs!);
    }
    if (handler.kind === "pdf") {
      if (!this.llm) {
        // Shouldn't happen — sync() is only ever called on a connector
        // built from index.ts with an LlmManager. The guard is here so
        // TypeScript is happy that llm isn't undefined in this branch.
        throw new Error(
          "PDF ingestion requires an LLM manager. This is a wiring bug — sync was called on a GoogleDriveConnector constructed without one."
        );
      }
      const bytes = await this.downloadBytes(accessToken, file.id);
      return extractPdfToMarkdown(this.llm, bytes, `Google Drive / ${file.name}`);
    }
    // handler.kind === "download"
    const bytes = await this.downloadBytes(accessToken, file.id);
    const text = bytes.toString("utf-8");
    if (handler.downloadAs === "html") {
      return stripHtmlTags(text);
    }
    return text;
  }

  /**
   * Download the raw bytes of a Drive file via alt=media. Works for
   * any non-Google-Apps file type (PDFs, text files, office docs, etc.).
   * Google Apps files (Docs, Sheets, Slides) cannot be downloaded this
   * way and must go through /export instead.
   */
  private async downloadBytes(
    accessToken: string,
    fileId: string
  ): Promise<Buffer> {
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}`);
    url.searchParams.set("alt", "media");
    url.searchParams.set("supportsAllDrives", "true");
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Drive download failed: ${res.status} ${text.slice(0, 300)}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Export a Google Apps file (Doc, Sheet, Slides) to the given target
   * mimeType as text. Replaces the old exportDocAsMarkdown helper with
   * a mimeType-agnostic version.
   */
  private async exportAsText(
    accessToken: string,
    fileId: string,
    targetMimeType: string
  ): Promise<string> {
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}/export`);
    url.searchParams.set("mimeType", targetMimeType);
    url.searchParams.set("supportsAllDrives", "true");
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      // If the primary export format isn't supported for this file,
      // fall back to plain text (which all Google Apps types support).
      if (targetMimeType !== "text/plain") {
        url.searchParams.set("mimeType", "text/plain");
        const fallback = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (fallback.ok) return fallback.text();
      }
      const text = await res.text();
      throw new Error(`Doc export failed: ${res.status} ${text.slice(0, 200)}`);
    }
    return res.text();
  }

  // ─── Helpers ─────────────────────────────────────────────────

  /**
   * Get a service account access token, refreshing if needed.
   * Service accounts use the JWT bearer flow rather than refresh tokens —
   * we sign a fresh JWT and exchange it for an access token whenever the
   * cached one is missing or expired.
   */
  private async ensureServiceAccountToken(
    state: GoogleDriveState,
    key: ServiceAccountKey
  ): Promise<string> {
    const now = Date.now();
    const expiry = state.accessTokenExpiry ?? 0;
    if (state.accessToken && expiry - now > 60_000) {
      return state.accessToken;
    }

    const jwt = this.signServiceAccountJWT(key, GOOGLE_DRIVE_OAUTH_SCOPES);
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    });

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Service account token exchange failed: ${res.status} ${text.slice(0, 300)}`
      );
    }
    const tokens = (await res.json()) as { access_token: string; expires_in: number };

    state.accessToken = tokens.access_token;
    state.accessTokenExpiry = now + tokens.expires_in * 1000;
    return tokens.access_token;
  }

  /** Sign a JWT for service account authentication */
  private signServiceAccountJWT(key: ServiceAccountKey, scopes: string[]): string {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", typ: "JWT" };
    const payload = {
      iss: key.client_email,
      scope: scopes.join(" "),
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    };

    const headerB64 = base64url(Buffer.from(JSON.stringify(header)));
    const payloadB64 = base64url(Buffer.from(JSON.stringify(payload)));
    const signingInput = `${headerB64}.${payloadB64}`;

    const signer = createSign("RSA-SHA256");
    signer.update(signingInput);
    signer.end();
    const signature = signer.sign(key.private_key);

    return `${signingInput}.${base64url(signature)}`;
  }

  /** Refresh the access token if it's missing or about to expire */
  private async ensureAccessToken(
    state: GoogleDriveState,
    config: GoogleDriveConfig
  ): Promise<string> {
    const now = Date.now();
    const expiry = state.accessTokenExpiry ?? 0;
    if (state.accessToken && expiry - now > 60_000) {
      return state.accessToken;
    }
    if (!state.refreshToken) {
      throw new Error("Missing refresh token. Reconnect Google Drive in settings.");
    }
    const tokens = await this.refreshAccessToken(
      state.refreshToken,
      config.clientId,
      config.clientSecret
    );
    // Mutate state in place; the runner will save the updated state on success
    state.accessToken = tokens.access_token;
    state.accessTokenExpiry = now + tokens.expires_in * 1000;
    return tokens.access_token;
  }

  /**
   * List ingestible files, sorted by modifiedTime descending.
   *
   * "Ingestible" means anything whose Drive mimeType is in
   * SUPPORTED_MIME_TYPES — native Google Docs/Sheets/Slides, PDFs, and
   * a set of plain-text-ish formats.
   *
   * Folder-scoping logic:
   * - No folderFilter set → search every supported file the account can see.
   * - folderFilter set, recurseSubfolders off → only files whose immediate
   *   parent is that folder (the old behaviour, kept for opt-out).
   * - folderFilter set, recurseSubfolders on → BFS-expand the folder tree
   *   first, then query for files whose parent is any descendant folder.
   *   The descendant set is batched into groups of FOLDERS_PER_QUERY to
   *   stay under Drive's query-length ceiling.
   */
  private async listFiles(
    accessToken: string,
    config: GoogleDriveConfig,
    sinceModified: string | undefined,
    maxFiles: number
  ): Promise<GoogleDriveFile[]> {
    // Parse out the configured root folder IDs. Multiple entries allowed
    // via newlines or commas; the legacy single-folder key is read as a
    // fallback for old connector rows.
    const rootIds = parseFolderIds(config);

    // Resolve which folders we actually want to search. Empty array means
    // "no folder filter at all" — search everything visible to the account.
    let folderIds: string[] = [];
    if (rootIds.length > 0) {
      if (config.recurseSubfolders) {
        // Walk each root's tree, unioning descendants across roots and
        // deduping (the same folder can appear under multiple roots if
        // Drive's multi-parent semantics are in play).
        const seen = new Set<string>();
        for (const root of rootIds) {
          const descendants = await this.listDescendantFolderIds(
            accessToken,
            root
          );
          for (const id of descendants) {
            if (!seen.has(id)) {
              seen.add(id);
              folderIds.push(id);
            }
          }
        }
        console.log(
          `[google-drive] recursive folder scan: ${folderIds.length} folder(s) across ${rootIds.length} root(s)`
        );
      } else {
        folderIds = [...rootIds];
      }
    }

    // Build parent-clause batches. [""] is a sentinel that means "no
    // folder filter" for the outer loop; the per-batch query just skips
    // the parents clause when that's active.
    const parentBatches: string[][] =
      folderIds.length === 0
        ? [[]]
        : chunkArray(folderIds, FOLDERS_PER_QUERY);

    // Build the mimeType OR clause once; reused per batch.
    const mimeClause = SUPPORTED_MIME_LIST.map((m) => `mimeType='${m}'`).join(
      " or "
    );

    const seen = new Set<string>();
    const collected: GoogleDriveFile[] = [];

    outer: for (const batch of parentBatches) {
      const queryParts: string[] = [
        `(${mimeClause})`,
        "trashed=false",
      ];
      if (batch.length > 0) {
        const parentClause = batch.map((id) => `'${id}' in parents`).join(" or ");
        queryParts.push(`(${parentClause})`);
      }
      const q = queryParts.join(" and ");

      let pageToken: string | undefined;
      while (collected.length < maxFiles) {
        const url = new URL("https://www.googleapis.com/drive/v3/files");
        url.searchParams.set("q", q);
        url.searchParams.set("orderBy", "modifiedTime desc");
        url.searchParams.set("pageSize", String(Math.min(100, maxFiles + 5)));
        url.searchParams.set(
          "fields",
          "nextPageToken,files(id,name,mimeType,modifiedTime,createdTime,webViewLink,owners)"
        );
        // Required for service accounts that need to see files shared
        // from outside their own (empty) Drive. Safe to set on every
        // request.
        url.searchParams.set("supportsAllDrives", "true");
        url.searchParams.set("includeItemsFromAllDrives", "true");
        if (pageToken) url.searchParams.set("pageToken", pageToken);

        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) {
          const text = await res.text();
          // Log the URL we sent (without the bearer token) so we can debug
          // 404s and similar weirdness from the Drive API
          console.error(
            `[google-drive] list failed: ${res.status}\n  url: ${url.toString()}\n  body: ${text.slice(0, 500)}`
          );
          throw new Error(`Drive list failed: ${res.status} ${text.slice(0, 300)}`);
        }
        const json = (await res.json()) as DriveFileListResponse;

        for (const file of json.files ?? []) {
          // Sorted descending; stop if we hit something older than the cursor
          if (sinceModified && file.modifiedTime <= sinceModified) {
            // Finish this batch; other batches may still have newer files.
            break;
          }
          // A Drive file can live under multiple parents; across batches we
          // might see the same file twice. Dedup by id to keep the count
          // honest.
          if (seen.has(file.id)) continue;
          seen.add(file.id);
          collected.push(file);
          if (collected.length >= maxFiles) break outer;
        }

        if (!json.nextPageToken) break;
        pageToken = json.nextPageToken;
      }
    }

    // Re-sort: batches are descending per-query, but across batches the
    // combined list may not be in order. Sort newest first, then reverse
    // for the "oldest first within batch" contract the caller expects.
    collected.sort((a, b) => (a.modifiedTime < b.modifiedTime ? 1 : -1));
    return collected.reverse();
  }

  /**
   * Walk the folder tree rooted at `rootId` and return every folder ID
   * inside it, including the root itself. Uses BFS with a visited-set
   * (Drive permits a folder to have multiple parents, so the graph can
   * contain cycles in pathological cases) and a hard cap to protect
   * against runaway expansion.
   */
  private async listDescendantFolderIds(
    accessToken: string,
    rootId: string
  ): Promise<string[]> {
    const visited = new Set<string>([rootId]);
    const queue: string[] = [rootId];
    const result: string[] = [rootId];

    while (queue.length > 0 && result.length < MAX_DESCENDANT_FOLDERS) {
      // Pull a small batch of parents off the queue so we can OR them
      // into one Drive query instead of one call per folder. Same batch
      // size reasoning as listDocs.
      const batch = queue.splice(0, FOLDERS_PER_QUERY);
      const parentClause = batch.map((id) => `'${id}' in parents`).join(" or ");
      const q = `mimeType='application/vnd.google-apps.folder' and trashed=false and (${parentClause})`;

      let pageToken: string | undefined;
      do {
        const url = new URL("https://www.googleapis.com/drive/v3/files");
        url.searchParams.set("q", q);
        url.searchParams.set("pageSize", "100");
        url.searchParams.set("fields", "nextPageToken,files(id,name)");
        url.searchParams.set("supportsAllDrives", "true");
        url.searchParams.set("includeItemsFromAllDrives", "true");
        if (pageToken) url.searchParams.set("pageToken", pageToken);

        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) {
          const text = await res.text();
          console.error(
            `[google-drive] folder expansion failed: ${res.status}\n  body: ${text.slice(0, 500)}`
          );
          throw new Error(`Drive folder expansion failed: ${res.status} ${text.slice(0, 300)}`);
        }
        const json = (await res.json()) as DriveFileListResponse;

        for (const folder of json.files ?? []) {
          if (visited.has(folder.id)) continue;
          visited.add(folder.id);
          result.push(folder.id);
          queue.push(folder.id);
          if (result.length >= MAX_DESCENDANT_FOLDERS) {
            console.warn(
              `[google-drive] folder expansion hit ${MAX_DESCENDANT_FOLDERS}-folder cap under ${rootId}; some sub-folders will be skipped`
            );
            return result;
          }
        }

        pageToken = json.nextPageToken;
      } while (pageToken);
    }

    return result;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Short, human-friendly tag we put on ingested sources so they're easy
 * to filter in the graph and the log. One tag per Drive mimeType.
 */
function mimeToTag(mimeType: string): string {
  switch (mimeType) {
    case "application/vnd.google-apps.document":
      return "google-doc";
    case "application/vnd.google-apps.spreadsheet":
      return "google-sheet";
    case "application/vnd.google-apps.presentation":
      return "google-slides";
    case "application/pdf":
      return "pdf";
    case "text/markdown":
    case "text/x-markdown":
      return "markdown";
    case "text/csv":
    case "text/tab-separated-values":
      return "table";
    case "application/json":
    case "application/yaml":
    case "text/yaml":
    case "application/xml":
    case "text/xml":
      return "data";
    case "text/html":
      return "html";
    default:
      return "file";
  }
}

/**
 * Rough HTML-to-text stripper. Same approach as api/files.ts — we save
 * tokens by dropping markup the LLM doesn't need, without pulling in a
 * full HTML parser.
 */
function stripHtmlTags(html: string): string {
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

/** Split an array into fixed-size chunks. */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/** base64url encoding (RFC 4648, no padding) */
function base64url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Accept either a raw folder ID or a Drive folder URL and return just
 * the ID. Strips URL prefixes, query strings (resourcekey, usp, etc.),
 * and any whitespace. Drive folder IDs are alphanumeric with dashes
 * and underscores — anything else is noise we can drop.
 */
function sanitizeFolderId(input: string | undefined): string {
  if (!input) return "";
  let id = input.trim();
  // Pull the ID out of a full Drive URL if pasted as such
  const urlMatch = id.match(/\/folders\/([^/?#]+)/);
  if (urlMatch) {
    id = urlMatch[1];
  }
  // Drop query string and hash (e.g. "?resourcekey=..." or "?usp=sharing")
  id = id.split("?")[0].split("#")[0];
  return id.trim();
}

/**
 * Parse the user's `folderFilters` input into a deduplicated list of
 * Drive folder IDs. Accepts both newline-separated and comma-separated
 * entries (and any mixture), tolerates full Drive URLs per entry, and
 * silently drops empty lines and invalid-looking entries.
 *
 * Also accepts the legacy single-folder key `folderFilter` as a
 * fallback so existing connector rows from before this change keep
 * working until the user re-saves their settings.
 */
function parseFolderIds(config: {
  folderFilters?: string;
  folderFilter?: string;
}): string[] {
  const raw =
    (config.folderFilters && config.folderFilters.trim()) ||
    (config.folderFilter && config.folderFilter.trim()) ||
    "";
  if (!raw) return [];

  // Split on newlines and commas (any number of either)
  const parts = raw.split(/[\n,]+/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const id = sanitizeFolderId(part);
    // Drive folder IDs are alphanumeric with - and _, typically 25–44 chars.
    // A plausibility check drops obvious garbage (e.g. a stray URL fragment)
    // without being so strict we reject legitimate IDs.
    if (id.length < 10 || !/^[A-Za-z0-9_-]+$/.test(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
