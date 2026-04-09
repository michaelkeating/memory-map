import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import type { ConnectorStore } from "../connectors/store.js";
import {
  GoogleDriveConnector,
  GOOGLE_DRIVE_REDIRECT_PATH,
} from "../connectors/google-drive.js";
import { config } from "../config.js";

/**
 * Pending OAuth state tokens. We generate one when the user initiates
 * the flow and validate it on callback to prevent CSRF.
 */
const pendingStates = new Map<string, { connectorType: string; createdAt: number }>();

function cleanupExpiredStates() {
  const now = Date.now();
  for (const [token, info] of pendingStates) {
    if (now - info.createdAt > 10 * 60 * 1000) {
      pendingStates.delete(token);
    }
  }
}

function buildRedirectUri(connectorPath: string): string {
  // Always use the server's external port (not the Vite dev server port).
  // This must EXACTLY match the redirect URI registered in Google Cloud Console.
  return `http://localhost:${config.port}${connectorPath}`;
}

export function registerOAuthRoutes(
  app: FastifyInstance,
  connectorStore: ConnectorStore
) {
  const driveConnector = new GoogleDriveConnector();

  // ─── Google Drive OAuth ────────────────────────────────────

  /** Step 1: redirect the user to Google's consent page */
  app.get("/api/oauth/start/google-drive", async (_request, reply) => {
    const c = connectorStore.getByType("google-drive");
    if (!c) return reply.code(404).send({ error: "Google Drive connector not registered" });

    const cfg = c.config as { clientId?: string; clientSecret?: string };
    if (!cfg.clientId || !cfg.clientSecret) {
      return reply.code(400).send({
        error: "Configure Client ID and Client Secret first, then click Connect.",
      });
    }

    cleanupExpiredStates();
    const stateToken = randomBytes(24).toString("hex");
    pendingStates.set(stateToken, {
      connectorType: "google-drive",
      createdAt: Date.now(),
    });

    const redirectUri = buildRedirectUri(GOOGLE_DRIVE_REDIRECT_PATH);
    const url = driveConnector.buildAuthUrl(cfg.clientId, redirectUri, stateToken);
    reply.redirect(url);
  });

  /** Step 2: Google redirects here with ?code=... after the user approves */
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    GOOGLE_DRIVE_REDIRECT_PATH,
    async (request, reply) => {
      const { code, state, error } = request.query;

      if (error) {
        return reply
          .type("text/html")
          .send(closingPage(`Authorization denied: ${error}`));
      }
      if (!code || !state) {
        return reply.type("text/html").send(closingPage("Missing code or state"));
      }

      const stateInfo = pendingStates.get(state);
      if (!stateInfo || stateInfo.connectorType !== "google-drive") {
        return reply
          .type("text/html")
          .send(closingPage("Invalid or expired state token"));
      }
      pendingStates.delete(state);

      const c = connectorStore.getByType("google-drive");
      if (!c) {
        return reply
          .type("text/html")
          .send(closingPage("Google Drive connector not registered"));
      }

      const cfg = c.config as { clientId: string; clientSecret: string };
      const redirectUri = buildRedirectUri(GOOGLE_DRIVE_REDIRECT_PATH);

      try {
        const tokens = await driveConnector.exchangeCode(
          code,
          cfg.clientId,
          cfg.clientSecret,
          redirectUri
        );

        if (!tokens.refresh_token) {
          return reply.type("text/html").send(
            closingPage(
              "Google did not return a refresh token. Try revoking access at " +
                "https://myaccount.google.com/permissions and reconnecting."
            )
          );
        }

        const newState = {
          ...c.state,
          refreshToken: tokens.refresh_token,
          accessToken: tokens.access_token,
          accessTokenExpiry: Date.now() + tokens.expires_in * 1000,
        };

        connectorStore.updateState(c.id, newState);

        return reply
          .type("text/html")
          .send(closingPage("Connected successfully! You can close this tab."));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.type("text/html").send(closingPage(`Token exchange failed: ${msg}`));
      }
    }
  );

  /** Disconnect: clear stored tokens for a connector */
  app.post<{ Params: { type: string } }>(
    "/api/oauth/disconnect/:type",
    async (request, reply) => {
      const c = connectorStore.getByType(request.params.type);
      if (!c) return reply.code(404).send({ error: "Connector not found" });

      const newState = { ...c.state };
      delete newState.refreshToken;
      delete newState.accessToken;
      delete newState.accessTokenExpiry;
      connectorStore.updateState(c.id, newState);

      return { ok: true };
    }
  );
}

function closingPage(message: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Memory Map — OAuth</title>
  <style>
    body {
      font-family: -apple-system, system-ui, sans-serif;
      max-width: 480px;
      margin: 100px auto;
      padding: 0 20px;
      color: #18181b;
    }
    h1 { font-size: 18px; font-weight: 600; }
    p { color: #52525b; line-height: 1.5; }
    a { color: #18181b; }
  </style>
</head>
<body>
  <h1>Memory Map</h1>
  <p>${message}</p>
  <p><a href="javascript:window.close()">Close this tab</a></p>
  <script>setTimeout(() => { try { window.close(); } catch (_) {} }, 2500);</script>
</body>
</html>`;
}
