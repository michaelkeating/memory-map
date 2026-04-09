import type { Connector, SyncResult, IngestFn } from "./types.js";
import type { ConnectorRecord, ConfigField } from "@memory-map/shared";

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
  clientId: string;
  clientSecret: string;
  pollSeconds: number;
  maxFilesPerSync: number;
  folderFilter: string; // optional folder ID to restrict imports
  ingestHistorical: boolean;
}

const DEFAULT_CONFIG: GoogleDriveConfig = {
  clientId: "",
  clientSecret: "",
  pollSeconds: 1800,
  maxFilesPerSync: 25,
  folderFilter: "",
  ingestHistorical: true,
};

export const GOOGLE_DRIVE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
];

export const GOOGLE_DRIVE_REDIRECT_PATH = "/api/oauth/callback/google-drive";

const CONFIG_SCHEMA: ConfigField[] = [
  {
    key: "clientId",
    label: "OAuth Client ID",
    type: "text",
    required: true,
    description: "From your Google Cloud OAuth 2.0 Client ID. Ends in .apps.googleusercontent.com.",
    placeholder: "...apps.googleusercontent.com",
  },
  {
    key: "clientSecret",
    label: "OAuth Client Secret",
    type: "password",
    required: true,
    description: "From your Google Cloud OAuth 2.0 Client. Starts with GOCSPX-.",
    placeholder: "GOCSPX-…",
  },
  {
    key: "folderFilter",
    label: "Folder ID (optional)",
    type: "text",
    description: "Restrict imports to a specific folder. Find in the URL when you open the folder in Drive (the part after /folders/). Leave blank to import all accessible Docs.",
    placeholder: "1AbcDef...",
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

const SETUP_INSTRUCTIONS = `**Setup steps:**

1. Visit [console.cloud.google.com](https://console.cloud.google.com/) and either pick an existing project or create a new one.
2. Enable the **Google Drive API** under "APIs & Services → Library".
3. Configure the **OAuth consent screen** ("APIs & Services → OAuth consent screen"). Pick "External", fill in the required fields, and add yourself as a Test user. You don't need to publish.
4. Create credentials: "APIs & Services → Credentials → + Create credentials → OAuth client ID". Choose **Web application**.
5. Add this redirect URI exactly: \`http://localhost:3001/api/oauth/callback/google-drive\`
6. Copy the **Client ID** and **Client Secret** into the fields below and click **Save settings**.
7. Click **Connect with Google** below to grant Memory Map access to your Drive.
8. Once connected, click **Sync now** to start importing.`;

export class GoogleDriveConnector implements Connector {
  readonly type = "google-drive";
  readonly defaultName = "Google Drive";
  readonly defaultConfig = DEFAULT_CONFIG as unknown as Record<string, unknown>;
  readonly defaultPollSeconds = DEFAULT_CONFIG.pollSeconds;
  readonly configSchema = CONFIG_SCHEMA;
  readonly setupInstructions = SETUP_INSTRUCTIONS;

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

    // Ensure we have a valid access token
    const accessToken = await this.ensureAccessToken(state, config);

    // First sync: optionally skip historical
    const isFirstSync = !state.lastModifiedTime;
    if (isFirstSync && !config.ingestHistorical) {
      const latest = await this.listDocs(accessToken, config, undefined, 1);
      const cursor =
        latest.length > 0 ? latest[0].modifiedTime : new Date().toISOString();
      return {
        itemsFetched: 0,
        itemsIngested: 0,
        message: `First sync skipped historical files. Will ingest docs modified after ${cursor}.`,
        newState: {
          ...state,
          accessToken,
          accessTokenExpiry: state.accessTokenExpiry,
          lastModifiedTime: cursor,
          ingestedIds: [],
        },
      };
    }

    // Fetch Google Docs modified since cursor
    const files = await this.listDocs(
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
      try {
        const body = await this.exportDocAsMarkdown(accessToken, file.id);
        const trimmedBody = body.trim();
        if (trimmedBody.length < 10) continue; // skip empty docs

        const ownerLine =
          file.owners && file.owners.length > 0
            ? `\n_Owner: ${file.owners[0].displayName}_\n`
            : "";

        const content = `# ${file.name}\n${ownerLine}\n${trimmedBody}`;

        await ingestFn({
          externalSource: "google-drive",
          externalId: file.id,
          content,
          sourceLabel: `Google Drive / ${file.name}`,
          capturedAt: file.modifiedTime,
          tags: ["google-drive", "google-doc"],
        });

        ingested++;
        ingestedIds.add(file.id);
        if (file.modifiedTime > newestModified) {
          newestModified = file.modifiedTime;
        }

        // Be polite to Google
        await this.sleep(300);
      } catch (err) {
        console.error(`[google-drive] file ${file.id} failed:`, err);
        break;
      }
    }

    return {
      itemsFetched: files.length,
      itemsIngested: ingested,
      message: `Ingested ${ingested} of ${files.length} Google Docs`,
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

  // ─── Helpers ─────────────────────────────────────────────────

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

  /** List Google Docs, sorted by modifiedTime descending */
  private async listDocs(
    accessToken: string,
    config: GoogleDriveConfig,
    sinceModified: string | undefined,
    maxFiles: number
  ): Promise<GoogleDriveFile[]> {
    const collected: GoogleDriveFile[] = [];
    let pageToken: string | undefined;

    // Build search query: only Google Docs, optionally in a folder
    const queryParts: string[] = [
      "mimeType='application/vnd.google-apps.document'",
      "trashed=false",
    ];
    if (config.folderFilter) {
      queryParts.push(`'${config.folderFilter}' in parents`);
    }
    const q = queryParts.join(" and ");

    while (collected.length < maxFiles) {
      const url = new URL("https://www.googleapis.com/drive/v3/files");
      url.searchParams.set("q", q);
      url.searchParams.set("orderBy", "modifiedTime desc");
      url.searchParams.set("pageSize", String(Math.min(50, maxFiles + 5)));
      url.searchParams.set(
        "fields",
        "nextPageToken,files(id,name,mimeType,modifiedTime,createdTime,webViewLink,owners)"
      );
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Drive list failed: ${res.status} ${text.slice(0, 300)}`);
      }
      const json = (await res.json()) as DriveFileListResponse;

      for (const file of json.files ?? []) {
        // Sorted descending; stop if we hit something older than the cursor
        if (sinceModified && file.modifiedTime <= sinceModified) {
          return collected.reverse();
        }
        collected.push(file);
        if (collected.length >= maxFiles) break;
      }

      if (collected.length >= maxFiles || !json.nextPageToken) break;
      pageToken = json.nextPageToken;
    }

    return collected.reverse(); // oldest first within batch
  }

  /** Export a Google Doc as markdown */
  private async exportDocAsMarkdown(accessToken: string, fileId: string): Promise<string> {
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}/export`);
    url.searchParams.set("mimeType", "text/markdown");
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      // Fall back to plain text if markdown export not supported
      url.searchParams.set("mimeType", "text/plain");
      const fallback = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!fallback.ok) {
        const text = await fallback.text();
        throw new Error(`Doc export failed: ${fallback.status} ${text.slice(0, 200)}`);
      }
      return await fallback.text();
    }
    return await res.text();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
