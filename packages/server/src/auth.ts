import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fastifyCookie from "@fastify/cookie";
import { config } from "./config.js";

interface Credentials {
  /** Pre-shared key API consumers send as `Authorization: Bearer <key>` */
  apiKey: string;
  /** Server-side secret used to sign session cookies */
  sessionSecret: string;
}

const CREDENTIALS_FILENAME = "credentials.json";
const COOKIE_NAME = "mm_session";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 90; // 90 days

/**
 * Load credentials from data/credentials.json, or generate fresh ones
 * on first run. Persisted with 0600 permissions so only the running
 * user can read them.
 */
export function loadOrCreateCredentials(): Credentials {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const credPath = path.join(config.dataDir, CREDENTIALS_FILENAME);

  let creds: Credentials | null = null;
  let generated = false;

  if (fs.existsSync(credPath)) {
    try {
      const raw = fs.readFileSync(credPath, "utf-8");
      const parsed = JSON.parse(raw) as Credentials;
      if (parsed.apiKey && parsed.sessionSecret) {
        creds = parsed;
      }
    } catch {
      // fall through and regenerate
    }
  }

  if (!creds) {
    creds = {
      apiKey: randomBytes(32).toString("hex"),
      sessionSecret: randomBytes(48).toString("hex"),
    };
    generated = true;

    fs.writeFileSync(credPath, JSON.stringify(creds, null, 2), { mode: 0o600 });
    // Some filesystems ignore mode on create — re-apply explicitly
    try {
      fs.chmodSync(credPath, 0o600);
    } catch {
      // ignore
    }
  }

  mirrorKeyToScreenpipe(creds.apiKey);

  console.log("");
  console.log("───────────────────────────────────────────────────────────────");
  console.log(
    generated
      ? "Memory Map: generated new credentials"
      : "Memory Map: loaded existing credentials"
  );
  console.log("");
  console.log(`  API key:  ${creds.apiKey}`);
  console.log("");
  console.log("  Open Memory Map in your browser. You'll be asked for this");
  console.log("  key once and the session is remembered for 90 days.");
  console.log("");
  console.log(`  Stored at: ${credPath} (mode 600)`);
  console.log("───────────────────────────────────────────────────────────────");
  console.log("");

  return creds;
}

/**
 * Mirror the API key into ~/.screenpipe/memory-map.key (mode 600).
 *
 * The Screenpipe pipe at screenpipe-pipes/memory-map runs inside Screenpipe's
 * sandbox. If it reads a file outside ~/.screenpipe (e.g. our credentials.json
 * in the repo data dir), macOS prompts the user for file-access permission
 * each time. Mirroring the key into ~/.screenpipe keeps everything inside
 * one sandbox directory so no TCC prompts fire.
 *
 * We only write if ~/.screenpipe already exists — no point creating it on
 * machines where Screenpipe isn't installed.
 */
function mirrorKeyToScreenpipe(apiKey: string): void {
  try {
    const screenpipeDir = path.join(os.homedir(), ".screenpipe");
    if (!fs.existsSync(screenpipeDir)) return;
    const keyPath = path.join(screenpipeDir, "memory-map.key");
    // Only rewrite if the content has actually changed, to avoid churning
    // file mtime on every server start.
    let existing: string | null = null;
    try {
      existing = fs.readFileSync(keyPath, "utf-8");
    } catch {
      // missing or unreadable — we'll write fresh
    }
    if (existing === apiKey) return;
    fs.writeFileSync(keyPath, apiKey, { mode: 0o600 });
    try {
      fs.chmodSync(keyPath, 0o600);
    } catch {
      // ignore
    }
  } catch (err) {
    console.warn(
      `Could not mirror API key to ~/.screenpipe/memory-map.key: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

/**
 * Sign a token (the API key) into a tamper-proof cookie payload.
 * The cookie value is `<token>.<hmac>` so the server can verify
 * that whatever's in the cookie wasn't forged.
 */
function signSession(apiKey: string, sessionSecret: string): string {
  const hmac = createHmac("sha256", sessionSecret).update(apiKey).digest("hex");
  return `${apiKey}.${hmac}`;
}

function verifySession(value: string, sessionSecret: string): boolean {
  const idx = value.lastIndexOf(".");
  if (idx < 0) return false;
  const token = value.slice(0, idx);
  const provided = value.slice(idx + 1);
  const expected = createHmac("sha256", sessionSecret).update(token).digest("hex");
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

function constantTimeStringEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/**
 * Routes/prefixes that bypass auth. The login endpoint obviously
 * needs to be reachable pre-auth. The OAuth callback comes from
 * external services (Google) and is protected by its own state token.
 * Health is for monitors.
 */
const PUBLIC_API_PATHS = new Set([
  "/api/health",
  "/api/auth/check",
  "/api/auth/login",
  "/api/auth/logout",
]);

const PUBLIC_API_PREFIXES = ["/api/oauth/callback/"];

function isPublicApiPath(url: string): boolean {
  // Strip query string
  const path = url.split("?")[0];
  if (PUBLIC_API_PATHS.has(path)) return true;
  return PUBLIC_API_PREFIXES.some((p) => path.startsWith(p));
}

export interface AuthOptions {
  /** Set true to disable auth entirely. Use only for tests. */
  disabled?: boolean;
}

export async function registerAuth(
  app: FastifyInstance,
  creds: Credentials,
  opts: AuthOptions = {}
) {
  await app.register(fastifyCookie);

  if (opts.disabled) {
    console.warn("⚠️  Auth is DISABLED. Anyone reaching the server can do anything.");
    return;
  }

  // Auth gate for /api/* — bearer token OR signed session cookie
  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    const url = request.url;

    // WebSocket upgrade and non-API paths are not gated here. WebSocket
    // auth is handled in its own hook in the websocket route.
    if (!url.startsWith("/api/")) return;

    if (isPublicApiPath(url)) return;

    // Try Authorization header first
    const authHeader = request.headers.authorization;
    if (authHeader) {
      const match = /^Bearer\s+(.+)$/i.exec(authHeader);
      if (match && constantTimeStringEquals(match[1].trim(), creds.apiKey)) {
        return; // OK
      }
    }

    // Then try the session cookie
    const cookie = request.cookies[COOKIE_NAME];
    if (cookie && verifySession(cookie, creds.sessionSecret)) {
      const idx = cookie.lastIndexOf(".");
      const token = cookie.slice(0, idx);
      if (constantTimeStringEquals(token, creds.apiKey)) {
        return; // OK
      }
    }

    return reply.code(401).send({ error: "Unauthorized" });
  });

  // POST /api/auth/login → exchange API key for a session cookie
  app.post<{ Body: { apiKey: string } }>("/api/auth/login", async (request, reply) => {
    const provided = request.body?.apiKey?.trim();
    if (!provided) {
      return reply.code(400).send({ error: "apiKey required" });
    }
    if (!constantTimeStringEquals(provided, creds.apiKey)) {
      return reply.code(401).send({ error: "Invalid API key" });
    }
    const cookieValue = signSession(creds.apiKey, creds.sessionSecret);
    reply.setCookie(COOKIE_NAME, cookieValue, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: COOKIE_MAX_AGE_SECONDS,
    });
    return { ok: true };
  });

  // POST /api/auth/logout → clear cookie
  app.post("/api/auth/logout", async (_request, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return { ok: true };
  });

  // GET /api/auth/check → does this request have a valid auth?
  app.get("/api/auth/check", async (request) => {
    const authHeader = request.headers.authorization;
    if (authHeader) {
      const match = /^Bearer\s+(.+)$/i.exec(authHeader);
      if (match && constantTimeStringEquals(match[1].trim(), creds.apiKey)) {
        return { authed: true, via: "bearer" };
      }
    }
    const cookie = request.cookies[COOKIE_NAME];
    if (cookie && verifySession(cookie, creds.sessionSecret)) {
      const idx = cookie.lastIndexOf(".");
      const token = cookie.slice(0, idx);
      if (constantTimeStringEquals(token, creds.apiKey)) {
        return { authed: true, via: "cookie" };
      }
    }
    return { authed: false };
  });
}

/**
 * Validate a WebSocket upgrade request. Same rules as the API gate
 * but called manually from the WS handler since hooks don't fire on
 * the upgrade path.
 */
export function isWebSocketRequestAuthed(
  request: FastifyRequest,
  creds: Credentials
): boolean {
  // Try the cookie (browsers send it on upgrade)
  const cookieHeader = request.headers.cookie;
  if (cookieHeader) {
    const cookies = Object.fromEntries(
      cookieHeader.split(";").map((c) => {
        const [k, ...v] = c.trim().split("=");
        return [k, v.join("=")];
      })
    );
    const cookie = cookies[COOKIE_NAME];
    if (cookie && verifySession(cookie, creds.sessionSecret)) {
      const idx = cookie.lastIndexOf(".");
      const token = cookie.slice(0, idx);
      if (constantTimeStringEquals(token, creds.apiKey)) return true;
    }
  }
  // Or the bearer token via query param (since browsers can't set
  // headers on WebSocket connections)
  const url = request.url;
  const match = url.match(/[?&]key=([^&]+)/);
  if (match) {
    try {
      const key = decodeURIComponent(match[1]);
      if (constantTimeStringEquals(key, creds.apiKey)) return true;
    } catch {
      // ignore
    }
  }
  return false;
}
