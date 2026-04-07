# Memory Map — Design Document

**Your personal, LLM-native knowledge graph.** A self-hosted system where you converse with your knowledge, an LLM organizes and connects it, and a live graph visualization shows you the shape of your mind.

Memory Map is not a better Roam or Obsidian. It's the **persistent brain** that any AI plugs into — the durable, portable, user-owned memory layer that no single AI vendor will ever give you.

---

## 1. Core Principles

- **Own your data**: All data lives on your machine in human-readable Markdown, version-controlled with Git. If every AI vendor disappeared tomorrow, your knowledge is still plain text files.
- **Chat-first, not editor-first**: The primary interface is a conversation. You talk to your graph; the LLM organizes, connects, and retrieves. You never have to "create a page" manually.
- **LLM-native from day one**: The LLM isn't a Phase 4 add-on. It's the core intelligence — auto-organizing input, maintaining semantic associations, synthesizing answers from across your graph.
- **Graph visualization is central**: Not for navigation (the LLM handles retrieval) but for **understanding the shape of your knowledge** — seeing clusters, gaps, evolution, and unexpected connections.
- **Vendor-independent**: Claude today, something else tomorrow. The knowledge graph is the durable layer; the LLM is a replaceable intelligence that reads from and writes to it.
- **Multi-source**: Ingests from chat, email, meeting transcripts, Google Docs, screen recordings, and any future source via a connector system.

---

## 2. Why This Isn't Just Claude/Gemini

| | Claude/Gemini Memory | Memory Map |
|---|---|---|
| **You can see it** | No — black box | Yes — Markdown files + graph visualization |
| **You own it** | No — vendor servers | Yes — your machine, Git-versioned |
| **Multiple AIs can use it** | No — locked to one vendor | Yes — any agent with API access |
| **You control the structure** | No | Yes — inspect, edit, correct the graph |
| **Survives vendor changes** | No | Yes — it's just files |
| **Cross-tool integration** | Limited | Full — email, Screenpipe, Granola, anything |
| **Visualize connections** | No | Yes — that's the whole point |

**Mental model**: Claude is a brilliant colleague with amnesia. Memory Map is the shared whiteboard, filing cabinet, and relationship map that any colleague can walk up to and use.

---

## 3. Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                        Clients                                │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐               │
│  │ Desktop  │  │ Mobile   │  │ AI Agents     │               │
│  │ Browser  │  │ Browser  │  │ (API clients) │               │
│  └────┬─────┘  └────┬─────┘  └──────┬────────┘               │
└───────┼──────────────┼───────────────┼────────────────────────┘
        │              │               │
        ▼              ▼               ▼
┌──────────────────────────────────────────────────────────────┐
│                    Memory Map Server                          │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                 REST + WebSocket API                    │  │
│  │           (auth, chat, CRUD, search, graph)            │  │
│  └───────────────────────┬────────────────────────────────┘  │
│                          │                                   │
│  ┌───────────────────────┼────────────────────────────────┐  │
│  │              LLM Intelligence Layer                     │  │
│  │                                                         │  │
│  │  ┌─────────────────┐  ┌──────────────────────────────┐ │  │
│  │  │ Chat Processor  │  │ Auto-Organizer               │ │  │
│  │  │ (parse input,   │  │ (extract entities, create/   │ │  │
│  │  │  route intent,  │  │  update pages, generate      │ │  │
│  │  │  synthesize     │  │  associations)               │ │  │
│  │  │  answers)       │  │                              │ │  │
│  │  └─────────────────┘  └──────────────────────────────┘ │  │
│  │                                                         │  │
│  │  ┌─────────────────┐  ┌──────────────────────────────┐ │  │
│  │  │ Connector       │  │ Proactive Intelligence       │ │  │
│  │  │ Ingestion       │  │ (briefings, contradiction    │ │  │
│  │  │ (email, Granola,│  │  detection, pattern          │ │  │
│  │  │  Screenpipe,    │  │  recognition, action         │ │  │
│  │  │  Google Docs)   │  │  extraction)                 │ │  │
│  │  └─────────────────┘  └──────────────────────────────┘ │  │
│  └─────────────────────────────────────────────────────────┘  │
│                          │                                   │
│  ┌───────────────────────┼────────────────────────────────┐  │
│  │              Core Engine                                │  │
│  │                                                         │  │
│  │  ┌────────────┐ ┌─────────────┐ ┌───────────────────┐  │  │
│  │  │ Link Index │ │ Association │ │ Full-Text Search  │  │  │
│  │  │ (explicit  │ │ Engine      │ │ (SQLite FTS5)     │  │  │
│  │  │  wikilinks)│ │ (semantic   │ │                   │  │  │
│  │  │            │ │  weighted   │ │ Embedding Search  │  │  │
│  │  │            │ │  graph)     │ │ (sqlite-vec)      │  │  │
│  │  └────────────┘ └─────────────┘ └───────────────────┘  │  │
│  │                                                         │  │
│  │  ┌────────────┐ ┌──────────────────────────────────┐   │  │
│  │  │ Markdown   │ │ File Watcher (live reload)       │   │  │
│  │  │ Parser     │ │                                  │   │  │
│  │  └────────────┘ └──────────────────────────────────┘   │  │
│  └─────────────────────────────────────────────────────────┘  │
│                          │                                   │
│  ┌───────────────────────▼────────────────────────────────┐  │
│  │                  Storage Layer                          │  │
│  │                                                         │  │
│  │  /data/pages/*.md          (content + YAML frontmatter) │  │
│  │  /data/memory-map.db       (associations, embeddings,   │  │
│  │                             search index, audit log)    │  │
│  │  /data/connectors/         (connector state + config)   │  │
│  │  Git repo                  (version history)            │  │
│  └─────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### Why this stack?

| Choice | Rationale |
|--------|-----------|
| **Markdown files on disk** | Human-readable, portable, Git-friendly, works if the app dies |
| **SQLite** | Zero-config, single-file DB, excellent FTS5, vector search via sqlite-vec |
| **In-memory link graph** | Fast traversal for backlinks and graph viz; rebuilt from files on startup |
| **Node.js / TypeScript** | One language front-to-back, rich ecosystem, good WebSocket support |
| **React + Canvas/WebGL** | Responsive UI; hardware-accelerated graph rendering |
| **WebSockets** | Real-time graph updates as the LLM processes input |
| **Claude API** | Primary LLM provider; swappable to other providers or local models |

---

## 4. The Three-Layer Relationship Model

Relationships between content exist at three layers, each stored differently, each serving a different purpose.

### Layer 1: Explicit Links (in Markdown files)

`[[Wikilinks]]` — created by humans or by the LLM when it organizes input. They live in the `.md` files themselves.

```markdown
Discussed [[Kubernetes]] migration with [[Marcus]].
```

Any LLM, any text editor, any future tool can read these. Most durable and portable. But binary — either a link exists or it doesn't. No weight, no type, no "why."

### Layer 2: Semantic Associations (in SQLite)

The core innovation. A structured graph of **typed, weighted, explained relationships** maintained by the LLM, stored in a format any LLM can read and update.

```sql
CREATE TABLE associations (
  id          TEXT PRIMARY KEY,
  source_id   TEXT NOT NULL REFERENCES pages(id),
  target_id   TEXT NOT NULL REFERENCES pages(id),
  type        TEXT NOT NULL,    -- relationship type
  weight      REAL NOT NULL,    -- 0.0 to 1.0, decays over time
  reason      TEXT NOT NULL,    -- natural language: WHY this association exists
  created_by  TEXT NOT NULL,    -- which model created it
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  stale       BOOLEAN DEFAULT FALSE
);

CREATE TABLE association_log (
  id             TEXT PRIMARY KEY,
  association_id TEXT NOT NULL,
  action         TEXT NOT NULL,   -- created, updated, deprecated
  old_weight     REAL,
  new_weight     REAL,
  model_id       TEXT NOT NULL,
  timestamp      TEXT NOT NULL,
  reason         TEXT             -- why the change was made
);
```

Example association:

```json
{
  "source": "infrastructure-migration",
  "target": "devops-conference-2025",
  "type": "informed_by",
  "weight": 0.82,
  "reason": "Conference notes on managed K8s directly address the complexity concerns raised in the migration plan",
  "created_by": "claude-sonnet-4-20250514"
}
```

The **`reason` field** is what makes this LLM-portable. A future model doesn't need to reverse-engineer why Claude drew this connection — it reads the reason, evaluates whether it still holds, and updates it.

#### Association types

| Type | Meaning |
|------|---------|
| `related_to` | General topical overlap |
| `informed_by` | One page's thinking draws from another |
| `contradicts` | Pages contain conflicting information |
| `alternative_to` | Competing options or approaches |
| `stakeholder` | Person connected to a project/topic |
| `evolved_into` | Idea in page A was refined into page B |
| `depends_on` | One topic/project requires another |
| `instance_of` | Specific case of a general concept |

Weights **decay over time** (old associations lose strength unless reinforced) and get **boosted** when the user interacts with both pages in the same session or the LLM encounters new evidence.

### Layer 3: Embeddings (in SQLite via sqlite-vec)

Vector representations of each page for similarity search. Used for **retrieval** — when you ask a question, the system does similarity search to pull candidate pages before the LLM reasons about them.

Embeddings are ephemeral and model-specific. They get regenerated when you switch embedding models. They're a performance optimization, not a knowledge representation.

### How the layers work together

| Operation | Layer used |
|-----------|-----------|
| "What pages relate to X?" | Layer 2 (associations) |
| "How does X relate to Y?" | Layer 2 (reason field), then Layer 3 + LLM for synthesis |
| "What should I do about X?" | Layer 3 (retrieval) → Layer 2 (context) → LLM (fresh reasoning) |
| Graph visualization | Layer 1 (explicit) + Layer 2 (semantic, weighted) |
| "What are my blind spots?" | Layer 2 (cluster analysis) → LLM (interprets gaps) |

### LLM handoff between models

When a new/different LLM processes a query, it receives:

```
Relevant pages: (retrieved via embeddings + associations)
- infrastructure-migration.md (content)
- devops-conference-2025.md (content)

Existing associations between these pages:
- infrastructure-migration → devops-conference-2025
  type: informed_by, weight: 0.82
  reason: "Conference notes on managed K8s directly address the
  complexity concerns raised in the migration plan"

You may: use associations as-is, update weights, add new ones,
or mark existing ones as stale if content no longer supports them.
```

The new LLM reads the `reason` field, evaluates it against current content, and either uses, updates, or deprecates. Full audit trail in `association_log`.

---

## 5. Chat-First Interface

The primary interface is a conversation, not a page editor. The graph visualization updates live alongside the chat.

### 5.1 Layout

```
┌─────────────────────────────────────────────────────────┐
│  Memory Map                              [Connectors] ⚙ │
├──────────────────────────────┬──────────────────────────┤
│                              │                          │
│         Chat Panel           │      Graph Panel         │
│                              │                          │
│  You: Had coffee with Marcus │    ┌───┐                 │
│  today. He's moved on from   │    │K8s│╌╌╌╌┐            │
│  the K8s migration — they    │    └───┘    ╎  ┌──────┐  │
│  went serverless instead.    │        ╎    ╎  │Marcus│  │
│                              │        ╎    ╎  └──┬───┘  │
│  MM: Got it. Updated Marcus  │    ┌───────────┐  │      │
│  and the migration page.     │    │Serverless │──┘      │
│  Created a serverless page.  │    └───────────┘         │
│  I notice your DevOps conf   │                          │
│  notes mentioned managed K8s │  Nodes pulse as they     │
│  as a solution — want me to  │  are created/updated     │
│  note that they chose a      │  in real-time.           │
│  different path?             │                          │
│                              │  Edges fade/strengthen   │
│  You: Yes, do that.          │  as associations change. │
│                              │                          │
│  ┌────────────────────────┐  │                          │
│  │ Type a message...      │  │                          │
│  └────────────────────────┘  │                          │
├──────────────────────────────┴──────────────────────────┤
│  [Chat] [Pages] [Connectors] [Graph Full]               │
└─────────────────────────────────────────────────────────┘
```

### 5.2 How input flows

1. **You type** (or paste, or a connector sends data)
2. **LLM processes**: extracts entities, concepts, facts, actions
3. **LLM organizes**: creates/updates Markdown pages, adds `[[wikilinks]]`, generates semantic associations
4. **LLM responds**: confirms what it did, surfaces related knowledge, asks clarifying questions
5. **Graph updates**: nodes and edges animate in real-time via WebSocket
6. **You correct** (if needed): "No, Marcus isn't on that project anymore" → LLM adjusts

No approval step by default. Full automation, correct when wrong.

### 5.3 Query modes

The chat handles both input and retrieval:

- **"Had a call with Sarah about the API redesign"** → LLM organizes this as new knowledge
- **"What do I know about distributed systems?"** → LLM traverses graph, synthesizes across pages, cites sources
- **"What did I discuss with Sarah last quarter?"** → LLM pulls from meeting notes, journals, project pages
- **"What are my blind spots in the migration plan?"** → LLM analyzes graph structure, finds gaps

### 5.4 Page view (secondary)

Pages are still viewable and editable directly — you might want to review what the LLM organized, make manual edits, or browse. But the page editor is a secondary interface, not the primary one.

---

## 6. Data Connectors

A pluggable system for ingesting data from external sources — similar to Claude Connectors but self-hosted and configurable.

### 6.1 Connector interface

Each connector implements:

```typescript
interface Connector {
  id: string;
  name: string;                          // "Gmail", "Granola", "Screenpipe"
  configure(): Promise<ConnectorConfig>; // OAuth, API keys, file paths
  poll(): Promise<RawItem[]>;            // fetch new items since last sync
  transform(item: RawItem): string;      // convert to text for LLM processing
}
```

### 6.2 Planned connectors

| Connector | Source | How it works |
|-----------|--------|-------------|
| **Email** | Gmail API or local IMAP | Polls for new messages, extracts threads |
| **Granola** | Local transcript files | Watches a directory for new `.md` transcripts |
| **Google Docs** | Google Drive API | Syncs starred/tagged documents |
| **Screenpipe** | Screenpipe API | Ingests OCR'd screen recordings and audio transcripts |
| **Files** | Local directory watch | Monitors a folder for new/changed files |
| **Web clips** | Browser extension or API | Save articles/snippets via a bookmarklet |

### 6.3 Connector management UI

```
┌─────────────────────────────────────┐
│  Connectors                         │
├─────────────────────────────────────┤
│  ● Gmail          [On]  Last: 2m ago│
│  ● Granola        [On]  Last: 1h ago│
│  ○ Screenpipe     [Off]             │
│  ○ Google Docs    [Off] [Configure] │
│                                     │
│  [+ Add Connector]                  │
└─────────────────────────────────────┘
```

Each connector can be toggled on/off. When on, it polls on a configurable interval. Ingested items go through the same LLM auto-organizer as chat input — entities extracted, pages created/updated, associations generated.

### 6.4 Connector ingestion flow

```
Connector polls → raw items → LLM processes each item →
  → creates/updates pages
  → generates associations
  → tags with source (e.g., source: "gmail", source: "granola")
  → graph updates via WebSocket
```

---

## 7. Graph Visualization

The graph is not for navigation (the chat handles that). It's for **understanding the shape of your knowledge**.

### 7.1 Rendering

- **Phase 1**: d3-force + HTML Canvas (fast to ship, handles 1000s of nodes)
- **Phase 2**: WebGL via pixi.js (GPU-accelerated, scales to 10k+ nodes)

### 7.2 What the graph shows

- **Nodes**: pages, sized by connection count, colored by source/tag/type
- **Explicit edges**: solid lines (from `[[wikilinks]]`)
- **Semantic edges**: dotted/translucent lines (from associations, opacity = weight)
- **Clusters**: auto-grouped by the LLM's association patterns
- **Heat map mode**: which areas are active vs. stale
- **Temporal mode**: animate how the graph evolved over time

### 7.3 Live updates

As you chat, the graph animates:
- New nodes appear and float into position
- Edges strengthen (thicken/brighten) or weaken (fade)
- Related nodes pulse when mentioned in conversation
- Clusters reorganize as new associations form

### 7.4 Interaction

- Click a node → open that page in a side panel
- Hover → highlight connections (1st and 2nd degree), show association reasons
- Drag to pin position (hybrid persistence: auto-layout by default, pinned on drag)
- Filter by tag, source, date range, association type
- "Focus mode" (The Brain style): selected node centered, connections orbit, smooth transitions
- "Reset view" recomputes all positions from scratch

### 7.5 LLM-powered graph intelligence

- **Suggested clusters**: "These 15 pages form a coherent topic I'd call 'API Design Philosophy'"
- **Gap analysis**: "Deep notes on frontend and backend, almost nothing on the integration layer"
- **Contradiction highlighting**: edges colored red where `contradicts` associations exist
- **Stale detection**: nodes that haven't been updated or referenced in a long time fade

---

## 8. Proactive Intelligence

The LLM doesn't just wait for input. It actively works on your knowledge:

- **Daily briefing**: "You have an unresolved question about X from last week. Y project hasn't been touched in 3 weeks. You mentioned following up with Z."
- **Contradiction detection**: "In March you noted approach A wouldn't work, but in April you're planning to use it for Project B."
- **Pattern recognition**: "You've written about this topic 12 times over 6 months. Here's how your thinking evolved."
- **Action extraction**: "From yesterday's meeting notes, it sounds like you committed to delivering X by Friday."
- **Connection surfacing**: "You and Sarah are both thinking about API versioning from different angles — her from the client side, you from the server side."

---

## 9. API Design

RESTful API with API key auth. This is how AI agents (Claude CoWork, OpenClaw, etc.) and connectors interact with the graph.

### 9.1 Chat

```
POST   /api/chat                      # send a message, get response + graph updates
GET    /api/chat/history               # retrieve chat history
```

### 9.2 Pages

```
GET    /api/pages                      # list pages (paginated, filterable)
GET    /api/pages/:id                  # get page content + metadata
POST   /api/pages                      # create page
PUT    /api/pages/:id                  # update page
DELETE /api/pages/:id                  # delete page
GET    /api/pages/:id/backlinks        # explicit backlinks
GET    /api/pages/:id/associations     # semantic associations
GET    /api/pages/:id/graph?depth=2    # local graph neighborhood
```

### 9.3 Associations

```
GET    /api/associations               # list/filter associations
POST   /api/associations               # create association
PUT    /api/associations/:id           # update (weight, reason, stale)
GET    /api/associations/types         # list association types
```

### 9.4 Search

```
GET    /api/search?q=distributed       # full-text search
GET    /api/search/semantic?q=...      # embedding-based similarity search
```

### 9.5 Graph

```
GET    /api/graph                      # full graph (nodes + edges from both layers)
GET    /api/graph/stats                # node count, edge count, clusters
GET    /api/graph/clusters             # LLM-identified topic clusters
```

### 9.6 Connectors

```
GET    /api/connectors                 # list configured connectors
POST   /api/connectors                 # add a connector
PUT    /api/connectors/:id             # update config, toggle on/off
POST   /api/connectors/:id/sync       # trigger manual sync
```

### 9.7 Bulk operations (for agents)

```
POST   /api/bulk/pages                 # create/update multiple pages
POST   /api/bulk/associations          # create multiple associations
```

### 9.8 WebSocket

```
ws://host/ws
  → { type: "page:created", page: {...} }
  → { type: "page:updated", page: {...} }
  → { type: "association:created", association: {...} }
  → { type: "association:updated", association: {...} }
  → { type: "graph:changed", delta: {...} }
  → { type: "chat:response", message: {...} }
  → { type: "connector:synced", connector: "gmail", items: 3 }
```

---

## 10. Data Model

### 10.1 Page (Markdown file)

```markdown
---
id: "01HWXYZ..."
title: "Distributed Systems"
created: "2026-04-06T12:00:00Z"
modified: "2026-04-06T14:30:00Z"
tags: ["computer-science", "architecture"]
aliases: ["distributed computing"]
source: "chat"
---

# Distributed Systems

A distributed system is one where components on networked computers
communicate and coordinate by passing messages.

Key concepts:
- [[CAP Theorem]] — you can only pick two of three
- [[Consensus Algorithms]] are how nodes agree
- Related to [[Microservices]] architecture
```

### 10.2 Storage layout

```
/data/
├── pages/                      # Layer 1: Markdown with [[wikilinks]]
│   ├── distributed-systems.md
│   ├── marcus.md
│   └── infrastructure-migration.md
│
├── memory-map.db               # SQLite database:
│   ├── associations            #   Layer 2: typed, weighted, explained edges
│   ├── association_log         #   Audit trail for all association changes
│   ├── embeddings              #   Layer 3: vector representations (sqlite-vec)
│   ├── search_index (FTS5)     #   Full-text search
│   ├── connector_state         #   Last sync timestamps, cursors
│   └── graph_positions         #   Pinned node positions
│
├── connectors/                 # Connector configuration
│   └── connectors.yaml
│
└── config.yaml                 # App configuration
```

---

## 11. LLM Integration

### 11.1 Provider: Claude API (primary)

- **Chat processing + auto-organization**: Claude Sonnet (fast, cost-effective for high-volume processing)
- **Deep synthesis + pattern recognition**: Claude Opus (for complex queries, briefings, contradiction detection)
- **Embeddings**: Voyage AI or local model (for vector search)

### 11.2 Cost management

- Use Sonnet for routine operations (input processing, page creation, simple queries)
- Use Opus only for deep synthesis, proactive intelligence, complex multi-page reasoning
- Cache frequently-accessed pages in prompts to reduce token usage
- Batch connector ingestion to minimize API calls
- Path to local models (Ollama/llama.cpp) for cost-sensitive operations

### 11.3 LLM swappability

The LLM layer interfaces through a provider abstraction:

```typescript
interface LLMProvider {
  chat(messages: Message[], context: GraphContext): Promise<LLMResponse>;
  embed(text: string): Promise<number[]>;
  model: string;  // tracked in association.created_by
}
```

Switch providers by changing config. All associations carry `created_by` metadata so you can see which model made which connections.

---

## 12. Implementation Phases

### Phase 1: Foundation + LLM Core
- [ ] Markdown file storage with YAML frontmatter
- [ ] `[[wikilink]]` parser and bidirectional link index
- [ ] SQLite database: FTS5 search, associations table, embeddings (sqlite-vec)
- [ ] Three-layer relationship model (explicit links, semantic associations, embeddings)
- [ ] Claude API integration (Sonnet for processing, Opus for synthesis)
- [ ] Chat interface with auto-organization (LLM processes input → creates pages + associations)
- [ ] REST API (pages, associations, search, chat)
- [ ] Basic graph visualization (d3-force, Canvas) with live WebSocket updates
- [ ] API key auth + passphrase for browser
- [ ] Docker deployment

### Phase 2: Connectors + Rich Graph
- [ ] Connector framework (interface, polling, ingestion pipeline)
- [ ] Gmail connector
- [ ] Granola transcript connector (directory watcher)
- [ ] Screenpipe connector
- [ ] Google Docs connector
- [ ] Connector management UI (toggle on/off, configure, manual sync)
- [ ] WebGL graph renderer (pixi.js)
- [ ] "The Brain" focus-mode visualization
- [ ] Graph customization (colors, sizes, layouts, filters)
- [ ] Responsive mobile layout + PWA

### Phase 3: Proactive Intelligence
- [ ] Daily briefings (unresolved questions, stale projects, follow-ups)
- [ ] Contradiction detection across pages
- [ ] Pattern recognition (thinking evolution over time)
- [ ] Action extraction from meeting notes and conversations
- [ ] LLM-suggested graph clusters and gap analysis
- [ ] Association weight decay and reinforcement system

### Phase 4: Power Features
- [ ] Block-level references and transclusion
- [ ] Import from Roam/Obsidian/Notion
- [ ] Local model support (Ollama) for cost-sensitive operations
- [ ] Browser extension for web clipping
- [ ] External file references (Google Drive, local files)
- [ ] Saved graph views and visual bookmarks

---

## 13. Tech Stack Summary

| Layer | Technology | Why |
|-------|-----------|-----|
| **Language** | TypeScript | Type safety, shared code front/back |
| **Server** | Node.js + Fastify | Fast, low-overhead, good plugin system |
| **Database** | SQLite (better-sqlite3 + sqlite-vec) | Zero-config, FTS5 + vector search, single file |
| **Storage** | Markdown files + Git | Portable, human-readable, versioned |
| **LLM** | Claude API (Sonnet + Opus) | Best reasoning; swappable via provider interface |
| **Embeddings** | Voyage AI or local | Vector search for retrieval |
| **Frontend** | React + Vite | Fast dev, fast builds |
| **Graph viz** | Phase 1: d3-force + Canvas | Quick to ship |
| | Phase 2: pixi.js (WebGL) | GPU-accelerated, scales to 10k+ nodes |
| **Real-time** | WebSockets (ws) | Live graph updates as LLM processes input |
| **Auth** | API keys + passphrase | Simple, sufficient for single-user self-hosted |
| **Deploy** | Docker | One-command setup |

---

## 14. Directory Structure

```
memory-map/
├── packages/
│   ├── server/                # Backend
│   │   ├── src/
│   │   │   ├── api/           # Route handlers (chat, pages, associations, graph)
│   │   │   ├── llm/           # LLM provider interface + Claude implementation
│   │   │   ├── engine/        # Core: parser, link index, association engine
│   │   │   ├── connectors/    # Connector framework + implementations
│   │   │   ├── storage/       # File system + SQLite operations
│   │   │   └── ws/            # WebSocket handlers
│   │   └── package.json
│   │
│   ├── web/                   # React frontend
│   │   ├── src/
│   │   │   ├── components/    # UI components
│   │   │   ├── chat/          # Chat interface
│   │   │   ├── graph/         # Graph visualization
│   │   │   ├── pages/         # Page viewer/editor
│   │   │   ├── connectors/    # Connector management UI
│   │   │   └── hooks/         # React hooks (API, WebSocket, graph state)
│   │   └── package.json
│   │
│   └── shared/                # Shared types and utilities
│       ├── src/
│       │   ├── types.ts       # Page, Association, GraphNode, Connector, etc.
│       │   └── utils.ts       # Markdown parsing, ID generation
│       └── package.json
│
├── Dockerfile
├── docker-compose.yml
├── package.json               # Workspace root
├── tsconfig.json
└── DESIGN.md                  # This file
```

---

## 15. Design Decisions

1. **Chat-first interface**: The primary interaction is conversational. The LLM organizes input automatically. Page editing exists as a secondary interface for review and manual corrections.

2. **Full automation, correct when wrong**: No approval dialogs. The LLM creates pages and associations freely. The user corrects mistakes rather than pre-approving every action. This minimizes friction — the #1 killer of knowledge tools.

3. **Three-layer relationships**: Explicit links (in Markdown, most durable), semantic associations (in SQLite, typed/weighted/explained), embeddings (ephemeral, for retrieval). Each layer serves a different purpose and has different durability.

4. **Associations are LLM-portable**: The `reason` field in natural language means any model can read, evaluate, and update associations created by a different model. Full audit trail via `association_log`.

5. **Block-level IDs**: Deferred to Phase 4. Not needed for MVP.

6. **Offline support**: Deferred. Single-user with Git versioning makes eventual sync straightforward.

7. **Extensibility**: API-first (not a plugin system). Connectors for data ingestion, REST API for agent integration.

8. **Graph position persistence**: Hybrid — auto-layout by default, pin on drag, unpin to reset.

9. **Single-user**: Auth is a passphrase for browser, API keys for agents.

10. **LLM cost management**: Sonnet for routine processing, Opus for deep synthesis. Path to local models for cost-sensitive operations.

---

## 16. External File References

Pages can reference files outside the Markdown graph:

```markdown
Check the [[quarterly report]](gdrive://1a2b3c4d5e) for details.
See the architecture diagram: ![[arch.png]](file:///data/attachments/arch.png)
```

### Supported reference types

| Scheme | Example | Behavior |
|--------|---------|----------|
| `gdrive://` | `gdrive://FILE_ID` | Links to Google Drive; renders preview if available |
| `file://` | `file:///data/attachments/photo.jpg` | Local file on the host machine |
| `http(s)://` | `https://example.com/doc.pdf` | External web resource |

### Configuration

```yaml
# references.yaml
handlers:
  gdrive:
    base_url: "https://drive.google.com/file/d/{id}"
    preview: iframe
    mirror_path: /data/gdrive-mirror/{id}
  file:
    allowed_paths:
      - /data/attachments
      - /data/gdrive-mirror
    preview: inline
```

---

## 17. Self-Hosting

### Deployment

```bash
# Docker (recommended)
docker run -d \
  -p 3000:3000 \
  -v /path/to/your/data:/data \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  memory-map:latest

# Direct
git clone <repo>
npm install && npm run build
ANTHROPIC_API_KEY=sk-ant-... DATA_DIR=/path/to/data npm start
```

### Requirements

- Node.js 20+ (or Docker)
- ~512MB RAM (server + LLM response caching)
- Anthropic API key
- Storage: Markdown files + SQLite DB

### Networking

- Runs on your LAN by default
- For internet access: reverse proxy (Caddy/nginx) with HTTPS
- Optional: Tailscale/WireGuard for secure remote access

### Security

- **API key authentication** for agent access
- **Passphrase auth** for browser access
- **HTTPS** via reverse proxy
- **Git history** as audit trail and backup
- **Rate limiting** to prevent runaway agents or connectors
