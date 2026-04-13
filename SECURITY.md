# Security & Privacy

Memory Map is designed to run **entirely on your own machine**. There is no
hosted version, no telemetry, no analytics, no "phone home." This document
spells out exactly where your data lives, what talks to what, and where the
edges of the trust boundary are so you can decide whether you're comfortable
running it.

If you find a vulnerability, please open a GitHub issue or email the
maintainer rather than disclosing it publicly.

## Threat model

Memory Map assumes:

- The machine you run it on is trusted. If someone has shell access to your
  laptop, they have your data — disk encryption is your job, not Memory Map's.
- Your local network may not be trusted (coffee shop WiFi, shared house). By
  default Memory Map only listens on `127.0.0.1`, so other devices on your
  network cannot reach it at all unless you opt in with `BIND_LAN=true`.
- The Anthropic API is trusted to handle the chat and organizer prompts you
  send it. If you're not comfortable with that, don't use Memory Map — Claude
  is the only LLM provider currently wired up, and the auto-organizer cannot
  run without it.
- Connectors (Screenpipe, Notion, Google Drive) are trusted to the extent
  that you've configured them. Their credentials live on your disk; see
  "Where credentials live" below.

Memory Map does **not** try to defend against:

- A malicious local user with read access to your home directory.
- Side-channel attacks against the Anthropic API.
- Compromised npm dependencies (you should review `pnpm-lock.yaml` if this
  matters to you — Memory Map pins all transitive deps).

## What runs and what it talks to

When you start Memory Map, exactly two processes run:

1. **`packages/server`** — Fastify on `127.0.0.1:3001`. This is the only
   process that touches your data. It makes outbound HTTPS calls to:
   - `api.anthropic.com` for chat / auto-organize / lint / tag
   - `api.notion.com` if you configure the Notion connector
   - `www.googleapis.com` if you configure the Google Drive connector
   - `localhost:3030` if Screenpipe is also running on this machine
2. **`packages/web`** — Vite dev server on `127.0.0.1:5173` (or static files
   served from the Fastify server in production). This is just the React UI
   — it talks only to `localhost:3001`.

Neither process opens any other ports or makes any other outbound calls.
You can verify this with `lsof -iTCP -sTCP:LISTEN -P` and a packet inspector
of your choice.

## Authentication

Memory Map generates a 256-bit API key on first run and writes it to
`data/credentials.json` with file mode `0600` (readable only by your user).
The same file holds a 384-bit session secret used to HMAC-sign browser
session cookies.

Every request to `/api/*` (except `/api/health`, `/api/auth/*`, and the
OAuth callback used by Notion / Google) must present either:

- `Authorization: Bearer <api-key>` — for programmatic use, or
- A valid `mm_session` cookie — for browsers, obtained by pasting the API
  key into the login page once. The cookie is `httpOnly`, `sameSite=lax`,
  and lasts 90 days. The signature is verified with `timingSafeEqual` so a
  forged cookie cannot be brute-forced byte-by-byte.

WebSocket upgrade requests are checked the same way (cookie or `?key=…`
query parameter). Unauthenticated requests get a `401` and are dropped at
the Fastify `onRequest` hook before any route handler runs.

To rotate the key, stop the server, delete `data/credentials.json`, and
restart. A fresh key will be generated and printed to your terminal. All
existing browser sessions become invalid.

## Where credentials live

Everything sensitive lives under `DATA_DIR` (default `./data`):

- `data/credentials.json` — Memory Map API key + session secret (mode 600)
- `data/memory-map.db` — SQLite database with pages index, chat history,
  connector configs (which include OAuth tokens for Notion and Google Drive,
  or the Google service-account JSON if you went that route)
- `data/pages/*.md` — your notes as plain markdown files

The `ANTHROPIC_API_KEY` is read from your shell environment or `.env` file.
It never gets written to disk by Memory Map.

If you're going to back up `DATA_DIR`, encrypt the backup. Connector OAuth
tokens are stored in plaintext in SQLite — anyone who gets your `.db` file
can impersonate you to Notion and Google Drive until you revoke the tokens
in those services' settings.

## Network exposure

The default is `127.0.0.1`-only for both the server and the Vite dev server.
Other devices on your network cannot reach Memory Map at all in the default
configuration.

If you want to use Memory Map from your phone or another machine on the same
network, set `BIND_LAN=true` in your `.env` file. This binds to `0.0.0.0`.
The login page becomes visible to anyone on the same network, but they
still need the API key to do anything.

For remote access from outside your network, the recommended setup is
[Tailscale](https://tailscale.com/) — keep the default `127.0.0.1` binding
and let Tailscale tunnel to your machine. SSH port forwarding
(`ssh -L 3001:localhost:3001 your-machine`) also works.

**Do not** put Memory Map on the public internet behind a reverse proxy
unless you really know what you're doing. The auth model is "single shared
secret" — it's appropriate for "me on my devices" but not for "me on the
open internet where bots will hammer the login endpoint forever."

## Data sent to Anthropic

When you chat or trigger the auto-organizer / lint / tag features, Memory
Map sends Claude:

- Your message
- Relevant pages it pulled from your local index (via FTS5 search)
- Existing associations connected to those pages
- A system prompt explaining how Memory Map's tools work

It does **not** send your full graph, your entire chat history, your
connector credentials, or anything outside of what's needed to answer the
current request. You can read the prompt builders directly in
`packages/server/src/llm/` if you want to verify.

Anthropic's data retention and training policies apply to that traffic. See
their [privacy page](https://www.anthropic.com/legal/privacy) for details.

## Uninstalling

Stop the server, delete the Memory Map directory, and delete `DATA_DIR` if
you put it elsewhere. There is no system-wide install, no daemon, no
launchctl plist, no `/etc/` files. Memory Map leaves no trace once those
two directories are gone.

If you connected Notion or Google Drive, also revoke those grants in their
respective account settings — Memory Map cannot do that for you.
