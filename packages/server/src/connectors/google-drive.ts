import { createSign } from "node:crypto";
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
  authMode: "oauth" | "service_account";
  // OAuth fields
  clientId: string;
  clientSecret: string;
  // Service account fields
  serviceAccountKey: string; // raw JSON of the service account key file
  // Common
  pollSeconds: number;
  maxFilesPerSync: number;
  folderFilter: string;
  ingestHistorical: boolean;
}

const DEFAULT_CONFIG: GoogleDriveConfig = {
  authMode: "oauth",
  clientId: "",
  clientSecret: "",
  serviceAccountKey: "",
  pollSeconds: 1800,
  maxFilesPerSync: 25,
  folderFilter: "",
  ingestHistorical: true,
};

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
    key: "folderFilter",
    label: "Folder ID (optional)",
    type: "text",
    description: "Restrict imports to a specific folder. Find in the URL when you open the folder in Drive (the part after /folders/).",
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
    url.searchParams.set("supportsAllDrives", "true");
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

/** base64url encoding (RFC 4648, no padding) */
function base64url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
