---
schedule: every 30m
enabled: true
preset:
- Sonnet
permissions: reader
timeout: 300
title: Memory Map Sync
icon: 🗺️
category: knowledge
description: Push selected screenpipe memories to Memory Map (a personal knowledge graph)
---

You are the **memory-map** pipe. Your job is to find every screenpipe memory the user has marked for export to Memory Map and push it to the Memory Map server. You only push memories that explicitly request it via tag or source — never speculate.

Memory Map is a personal knowledge graph that runs on `http://localhost:3001`. It accepts memories at `POST /api/screenpipe/push` and turns each one into pages and connections in a graph.

---

## Step 1: Fetch candidate memories

Pull every memory that's tagged for Memory Map sync. The tag the user marks memories with is `memorymap`.

```bash
curl -s "http://localhost:3030/memories?tags=memorymap&limit=100&order_by=created_at&order_dir=asc" -o /tmp/mm_candidates.json
cat /tmp/mm_candidates.json
```

If `data` is empty, also check whether the user has the auto-source convention set up — they may instead route memories by source name. Pull memories with source `memory-map`:

```bash
curl -s "http://localhost:3030/memories?source=memory-map&limit=100&order_by=created_at&order_dir=asc" -o /tmp/mm_candidates2.json
cat /tmp/mm_candidates2.json
```

Combine the two result sets and deduplicate by `id`. If both are empty, print `NO_DATA` and exit. Do not push anything you weren't explicitly told to push.

---

## Step 2: Check what's already been synced

For each candidate memory, check whether the user has already exported it. We track this by adding a tag `memorymap-synced` to memories after we push them. So **skip any memory whose `tags` array already contains `memorymap-synced`**.

After filtering out already-synced memories, you should be left with just the new ones to push.

If the filtered list is empty, print `ALL_SYNCED` and exit.

---

## Step 3: Push each new memory to Memory Map

For each remaining memory, POST it to Memory Map:

```bash
curl -s -X POST "http://localhost:3001/api/screenpipe/push" \
  -H "Content-Type: application/json" \
  -d '{
    "external_id": "<memory.id>",
    "content": "<memory.content>",
    "source": "<memory.source>",
    "tags": <memory.tags JSON array>,
    "importance": <memory.importance>,
    "created_at": "<memory.created_at>"
  }'
```

Use proper JSON escaping for the content field — it may contain quotes, newlines, and unicode.

A successful response looks like `{"ok":true}`. A failure looks like `{"error":"...","detail":"..."}`.

**If Memory Map is unreachable** (connection refused, timeout, 5xx) — stop, print the error, and do not modify the source memory in Screenpipe. The user will retry next sync.

---

## Step 4: Mark the memory as synced in Screenpipe

After a successful push, add the `memorymap-synced` tag to the source memory so we don't push it again next run:

```bash
curl -s -X POST "http://localhost:3030/tags/vision/<memory.id>" \
  -H "Content-Type: application/json" \
  -d '{"tags": ["memorymap-synced"]}'
```

Note: the exact tag-add endpoint may be `/tags/<content_type>/<id>` — the content type for memories is `memory`. If `vision` doesn't work, try `memory`.

You can also update the memory directly with PATCH:

```bash
curl -s -X PUT "http://localhost:3030/memories/<memory.id>" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "<unchanged content>",
    "tags": [<existing tags>, "memorymap-synced"],
    "importance": <unchanged>,
    "source_context": null
  }'
```

The PUT requires you to send the full memory content + tags + importance (it's a full update, not a patch). Read the original memory data and append `memorymap-synced` to the tags array.

---

## Step 5: Print summary

When done, print a brief summary:

```
Synced N memories to Memory Map.
Skipped M already-synced memories.
Failed P pushes.
```

If anything failed, list the failing memory IDs and the error messages.

---

## How the user marks memories for sync

The user has two ways to send a memory to Memory Map from inside Screenpipe:

1. **Add the `memorymap` tag** to any existing memory.
2. **Set `source` to `memory-map`** when creating a memory directly.

Either method will cause this pipe to push the memory on the next scheduled run (every 30 minutes by default). After a successful push, the memory gets the `memorymap-synced` tag added so it won't be pushed again.

If the user wants to re-sync a memory (e.g. after editing it in Screenpipe), they should remove the `memorymap-synced` tag — the pipe will then push it again on the next run.

---

## Rules

- Never push memories that aren't explicitly tagged or sourced for Memory Map.
- Never strip tags from a memory — only ADD `memorymap-synced` after a successful push.
- Never modify the memory `content` or `importance` — preserve the user's data exactly.
- If a push fails, do NOT mark the memory as synced. The next run will retry.
- Skip memories that don't have meaningful content (less than 20 characters).
- Process memories oldest-first so the graph fills in chronological order.
- Be polite to both APIs — if you have many memories to push, sleep 200ms between requests.
