# Memory Map — Design Document

A self-hosted knowledge graph with bidirectional linking, rich graph visualization, cross-device editing, and an API for AI agent access.

---

## 1. Core Principles

- **Own your data**: All data lives on your machine in a human-readable format (Markdown + YAML frontmatter), version-controlled with Git
- **Bidirectional links are first-class**: Every link automatically creates a backlink — no plugins, no workarounds
- **Graph visualization is central**: Not an afterthought — the graph view is a primary navigation and thinking tool
- **Multi-device, single source of truth**: One server, accessible from any browser on any device
- **Agent-friendly**: A clean API that AI agents (Claude CoWork, OpenClaw, etc.) can use to read, write, and traverse the graph

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                   Clients                        │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Desktop  │  │ Mobile   │  │ AI Agents     │  │
│  │ Browser  │  │ Browser  │  │ (API clients) │  │
│  └────┬─────┘  └────┬─────┘  └──────┬────────┘  │
│       │              │               │           │
└───────┼──────────────┼───────────────┼───────────┘
        │              │               │
        ▼              ▼               ▼
┌─────────────────────────────────────────────────┐
│              Memory Map Server                   │
│                                                  │
│  ┌───────────────────────────────────────────┐   │
│  │            REST + WebSocket API            │   │
│  │  (auth, CRUD, search, graph traversal)    │   │
│  └──────────────────┬────────────────────────┘   │
│                     │                            │
│  ┌──────────────────┼────────────────────────┐   │
│  │           Core Engine                      │   │
│  │                                            │   │
│  │  ┌────────────┐  ┌─────────────────────┐  │   │
│  │  │ Link Index │  │ Full-Text Search    │  │   │
│  │  │ (in-memory │  │ (SQLite FTS5)       │  │   │
│  │  │  bigraph)  │  │                     │  │   │
│  │  └────────────┘  └─────────────────────┘  │   │
│  │                                            │   │
│  │  ┌────────────┐  ┌─────────────────────┐  │   │
│  │  │ Markdown   │  │ File Watcher        │  │   │
│  │  │ Parser     │  │ (live reload)       │  │   │
│  │  └────────────┘  └─────────────────────┘  │   │
│  └────────────────────────────────────────────┘   │
│                     │                            │
│  ┌──────────────────▼────────────────────────┐   │
│  │         Storage Layer                      │   │
│  │                                            │   │
│  │  /data/pages/*.md    (content, frontmatter)│   │
│  │  /data/memory-map.db (search index, meta)  │   │
│  │  Git repo            (version history)     │   │
│  └────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### Why this stack?

| Choice | Rationale |
|--------|-----------|
| **Markdown files on disk** | Human-readable, portable, Git-friendly, works if the app dies |
| **SQLite** | Zero-config, single-file DB, excellent FTS5 for search, no separate service |
| **In-memory link graph** | Fast traversal for backlinks and graph viz; rebuilt from files on startup |
| **Node.js / TypeScript** | One language front-to-back, rich ecosystem, good WebSocket support |
| **React + Canvas/WebGL** | Responsive UI; hardware-accelerated graph rendering |
| **WebSockets** | Real-time sync across devices and live collaboration |

---

## 3. Data Model

### 3.1 Page (the core unit)

Each page is a Markdown file with YAML frontmatter:

```markdown
---
id: "01HWXYZ..."
title: "Distributed Systems"
created: "2026-04-06T12:00:00Z"
modified: "2026-04-06T14:30:00Z"
tags: ["computer-science", "architecture"]
aliases: ["distributed computing"]
---

# Distributed Systems

A distributed system is one where components on networked computers
communicate and coordinate by passing messages.

Key concepts:
- [[CAP Theorem]] — you can only pick two of three
- [[Consensus Algorithms]] are how nodes agree
- Related to [[Microservices]] architecture

## Daily Notes

- Discussed with [[Alice]] about [[Event Sourcing]]
```

### 3.2 Links

Links use `[[Page Title]]` syntax (like Roam/Obsidian). The engine maintains a bidirectional index:

```typescript
interface LinkIndex {
  // page ID -> set of page IDs it links to
  forward: Map<string, Set<string>>;
  // page ID -> set of page IDs that link to it
  backward: Map<string, Set<string>>;
}
```

When you view "CAP Theorem", you automatically see "Distributed Systems" in its **backlinks** panel — no manual linking required.

### 3.3 Blocks (future enhancement)

Like Roam, individual bullet points could become addressable units with their own IDs, enabling block-level references and transclusion. This is a Phase 2 feature.

---

## 4. Graph Visualization

This is the centerpiece — not a bolted-on feature.

### 4.1 Rendering

- **Engine**: WebGL via `pixi.js` or `Three.js` (2D with optional 3D mode)
- **Layout**: Force-directed (d3-force) with configurable parameters
- **Scale**: Must handle 10,000+ nodes smoothly (LOD rendering, spatial indexing, viewport culling)

### 4.2 Interaction

- Click a node to navigate to that page
- Drag nodes to rearrange; positions persist
- Zoom and pan with mouse/touch
- Hover to highlight connections (1st and 2nd degree)
- Filter by tag, date range, or search query
- "Local graph" view: show N-degree neighborhood around current page

### 4.3 Customization

Users can customize via a config file or UI:

- **Node appearance**: size by link count, color by tag, shape by type
- **Edge appearance**: thickness by link frequency, color by relationship type
- **Layout algorithm**: force-directed, hierarchical, radial, timeline
- **Clustering**: auto-group by tag, manual grouping
- **Saved views**: bookmark specific graph configurations

### 4.4 Inspiration: "The Brain" style

Optionally render in a "focus + context" mode like The Brain:
- Selected node is centered and large
- Directly connected nodes orbit around it
- 2nd-degree nodes form an outer ring
- Smooth animated transitions when navigating between nodes

---

## 5. API Design (for agents and integrations)

RESTful API with optional API key auth. This is how Claude CoWork, OpenClaw, or any automation tool interacts with your graph.

### 5.1 Pages

```
GET    /api/pages                    # list pages (paginated, filterable)
GET    /api/pages/:id                # get page content + metadata
POST   /api/pages                    # create page
PUT    /api/pages/:id                # update page
DELETE /api/pages/:id                # delete page
GET    /api/pages/:id/backlinks      # get all pages linking to this one
GET    /api/pages/:id/graph?depth=2  # get local graph neighborhood
```

### 5.2 Search

```
GET    /api/search?q=distributed     # full-text search
GET    /api/search?tag=cs&after=...  # filtered search
```

### 5.3 Graph

```
GET    /api/graph                    # full graph structure (nodes + edges)
GET    /api/graph/stats              # node count, edge count, clusters
```

### 5.4 Bulk operations (for agents)

```
POST   /api/bulk/pages               # create/update multiple pages at once
POST   /api/bulk/link                 # create links between existing pages
```

### 5.5 WebSocket events

```
ws://host/ws
  → { type: "page:updated", page: {...} }
  → { type: "page:created", page: {...} }
  → { type: "page:deleted", id: "..." }
  → { type: "graph:changed", delta: {...} }
```

---

## 6. Editor

### 6.1 Desktop (browser)

- Block-based editor (like Notion/Roam) built on **TipTap** (ProseMirror-based)
- `[[` triggers autocomplete for page linking
- `/` commands for block types (heading, todo, code, embed, etc.)
- Side-by-side: editor on left, local graph or backlinks on right
- Keyboard-driven: vim-style keybindings available

### 6.2 Mobile (browser)

- Same app, responsive layout
- Simplified toolbar for touch
- Swipe gestures for navigation
- Graph view with touch-optimized pan/zoom
- PWA for home-screen install and offline capability

### 6.3 Conflict resolution

Multiple devices editing simultaneously:
- WebSocket-based operational transforms (OT) or CRDT for real-time sync
- For the initial version: last-write-wins with Git history as a safety net
- Future: Yjs CRDT integration for true real-time collaboration

---

## 7. Self-Hosting

### 7.1 Deployment

```bash
# Option 1: Docker (recommended)
docker run -d \
  -p 3000:3000 \
  -v /path/to/your/data:/data \
  memory-map:latest

# Option 2: Direct
git clone <repo>
npm install && npm run build
DATA_DIR=/path/to/data npm start
```

### 7.2 Requirements

- Node.js 20+ (or Docker)
- ~256MB RAM for the server (scales with graph size)
- Storage: your Markdown files + SQLite DB

### 7.3 Networking

- Runs on your LAN by default
- For internet access: reverse proxy (Caddy/nginx) with HTTPS
- Optional: Tailscale/WireGuard for secure remote access without exposing ports

---

## 8. Security

- **API key authentication** for agent access
- **Session-based auth** (or passphrase) for browser access
- **HTTPS** via reverse proxy for remote access
- **Git history** as an audit trail and backup mechanism
- Rate limiting on the API to prevent runaway agents

---

## 9. Implementation Phases

### Phase 1: Foundation (MVP)
- [ ] Markdown file storage with YAML frontmatter
- [ ] `[[wikilink]]` parser and bidirectional link index
- [ ] SQLite FTS5 search index
- [ ] REST API (CRUD + search + backlinks)
- [ ] Basic web UI: page list, editor (TipTap), backlinks panel
- [ ] Basic graph visualization (d3-force, 2D canvas)
- [ ] API key auth
- [ ] Docker deployment

### Phase 2: Rich Graph + Mobile
- [ ] WebGL graph renderer (pixi.js or Three.js)
- [ ] "The Brain" focus-mode visualization
- [ ] Graph customization (colors, sizes, layouts)
- [ ] Responsive mobile layout + PWA
- [ ] Touch-optimized graph interaction
- [ ] WebSocket real-time updates across devices

### Phase 3: Power Features
- [ ] Block-level references and transclusion
- [ ] Daily notes with auto-linking
- [ ] Custom page templates
- [ ] Plugin/extension system
- [ ] Import from Roam/Obsidian/Notion
- [ ] CRDT-based real-time collaboration (Yjs)
- [ ] Saved graph views and visual bookmarks

### Phase 4: Agent Intelligence
- [ ] Agent-specific API endpoints (bulk ops, semantic search)
- [ ] Embeddings-based semantic similarity between pages
- [ ] Auto-suggested links (agent-powered)
- [ ] Knowledge graph analytics (orphan pages, clusters, etc.)
- [ ] Webhook integrations (notify agents of changes)

---

## 10. Tech Stack Summary

| Layer | Technology | Why |
|-------|-----------|-----|
| **Language** | TypeScript | Type safety, shared code front/back |
| **Server** | Node.js + Fastify | Fast, low-overhead, good plugin system |
| **Database** | SQLite (via better-sqlite3) | Zero-config, FTS5, single-file |
| **Storage** | Markdown files + Git | Portable, human-readable, versioned |
| **Editor** | TipTap (ProseMirror) | Extensible block editor, Markdown I/O |
| **Graph viz** | Phase 1: d3-force + Canvas | Quick to ship |
| | Phase 2: pixi.js / Three.js | GPU-accelerated, scales to 10k+ nodes |
| **Frontend** | React + Vite | Fast dev, fast builds |
| **Real-time** | WebSockets (ws) | Live sync across devices |
| **Auth** | API keys + session tokens | Simple, sufficient for self-hosted |
| **Deploy** | Docker | One-command setup |

---

## 11. Directory Structure

```
memory-map/
├── packages/
│   ├── server/              # Backend API + engine
│   │   ├── src/
│   │   │   ├── api/         # Route handlers
│   │   │   ├── engine/      # Core: parser, link index, search
│   │   │   ├── storage/     # File system + SQLite operations
│   │   │   └── ws/          # WebSocket handlers
│   │   └── package.json
│   │
│   ├── web/                 # React frontend
│   │   ├── src/
│   │   │   ├── components/  # UI components
│   │   │   ├── editor/      # TipTap editor config
│   │   │   ├── graph/       # Graph visualization
│   │   │   └── hooks/       # React hooks (API, WebSocket)
│   │   └── package.json
│   │
│   └── shared/              # Shared types and utilities
│       ├── src/
│       │   ├── types.ts     # Page, Link, GraphNode, etc.
│       │   └── utils.ts     # Markdown parsing, ID generation
│       └── package.json
│
├── Dockerfile
├── docker-compose.yml
├── package.json             # Workspace root
├── tsconfig.json
└── DESIGN.md                # This file
```

---

## 12. Open Questions

1. **Block-level IDs**: Should we assign IDs to individual bullets from day one (like Roam) or add this later? Adding later means a migration, but adding now adds complexity to the MVP.

2. **Offline support**: Should the PWA work fully offline with sync-on-reconnect? This significantly increases complexity (needs a client-side DB and conflict resolution).

3. **Plugin architecture**: How much extensibility do we want? A full plugin system (like Obsidian) is a major undertaking. An alternative is a simple "custom CSS + API hooks" approach.

4. **Graph persistence**: Should node positions in the graph view be saved and restored, or always computed fresh? Saved positions feel more personal but create state to manage.

5. **Multi-user**: Is this strictly single-user, or should it support a small team (e.g., family/partner)? Multi-user adds auth complexity but is a natural extension.
