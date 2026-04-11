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

You are the **memory-map** pipe. Your job is to push the user's screenpipe memories to Memory Map (`http://localhost:3001`) according to **export rules** the user manages inside the Memory Map app. Memory Map turns each pushed memory into pages and connections in a personal knowledge graph.

**You only push memories that match the user's rules.** Never speculate.

---

## Step 1: Read the export rules from Memory Map

The user configures which Screenpipe sources (and which tags within them) get exported. The rules live in Memory Map. Fetch them:

```bash
curl -s "http://localhost:3001/api/screenpipe/pipe-config" -o /tmp/mm_rules.json
cat /tmp/mm_rules.json
```

The response looks like:

```json
{
  "rules": {
    "digital-clone": { "enabled": true, "excludedTags": ["private"] },
    "personal-crm": { "enabled": true, "excludedTags": [] }
  },
  "enabledSources": [
    { "source": "digital-clone", "excludedTags": ["private"] },
    { "source": "personal-crm", "excludedTags": [] }
  ]
}
```

**If `enabledSources` is empty**, no sources are configured for export. Print `NO_RULES_CONFIGURED` and exit cleanly. The user needs to open Memory Map → Connectors → Pipe export rules and enable at least one source.

**If Memory Map is unreachable** (connection refused, timeout) — print the error and exit. Don't push anything.

---

## Step 2: Fetch candidate memories per source

For **each enabled source** in `enabledSources`, query Screenpipe for memories from that source:

```bash
curl -s "http://localhost:3030/memories?source=<source-name>&limit=100&order_by=created_at&order_dir=asc" -o /tmp/mm_candidates_<source>.json
```

Combine all results into a single list, deduplicating by `id`.

Also pull memories with the legacy `memorymap` tag (the user can still mark individual memories manually as a fallback):

```bash
curl -s "http://localhost:3030/memories?tags=memorymap&limit=100&order_by=created_at&order_dir=asc" -o /tmp/mm_manual.json
```

Add these to the combined list.

If the combined list is empty, print `NO_DATA` and exit.

---

## Step 3: Apply the per-source tag filter

For each candidate memory:

1. **Check if it's already been synced.** If its `tags` array contains `memorymap-synced`, skip it.
2. **Look up the rule for its source.** Find the matching entry in `enabledSources`. If none (e.g. it came in via the manual `memorymap` tag), there are no excluded tags — process it.
3. **Apply the excluded tag filter.** If ANY of the memory's tags appears in that source's `excludedTags` list, skip it.
4. **Skip empty/trivial memories.** If `content.length < 20`, skip it.

What's left is your set of memories to push.

If the filtered list is empty, print `ALL_FILTERED_OUT` and exit.

---

## Step 4: Push each memory to Memory Map

For each memory in the filtered list, POST it to Memory Map:

```bash
curl -s -X POST "http://localhost:3001/api/screenpipe/push" \
  -H "Content-Type: application/json" \
  -d '{
    "external_id": "<memory.id>",
    "content": "<memory.content properly JSON-escaped>",
    "source": "<memory.source>",
    "tags": <memory.tags JSON array>,
    "importance": <memory.importance>,
    "created_at": "<memory.created_at>"
  }'
```

A successful response is `{"ok":true}`. A failure is `{"error":"...","detail":"..."}`.

**If any push fails**, log the error but continue with the next memory. Memory Map being full or temporarily slow shouldn't block the rest.

Sleep 200ms between pushes to be polite to both APIs.

---

## Step 5: Mark the memory as synced

For each memory that was successfully pushed, add the `memorymap-synced` tag back in Screenpipe so it doesn't get pushed again next run.

The Screenpipe API for updating a memory is a full PUT — you have to send the original content, importance, and the full new tags array. Read each original memory, append `memorymap-synced` to its existing tags, and PUT it back:

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

If the PUT fails, log it but don't retry the push — the memory IS in Memory Map, it just may get pushed again next run. That's annoying but not destructive (Memory Map's push endpoint is idempotent on `external_id`).

---

## Step 6: Print summary

Print a single-line summary at the end:

```
Synced N memories. Skipped M (already synced or filtered). Failed P pushes.
```

If anything failed, list the failing memory IDs and the first 100 chars of each error message.

---

## How the user controls this

The user manages export rules inside Memory Map:

1. Open Memory Map
2. Click **Connectors** (header)
3. Find the **Screenpipe** card → click **Pipe export rules**
4. Toggle each Screenpipe source on/off
5. For enabled sources, click **Tags** to expand and click any tag to exclude it (line-through = excluded)
6. Click **Save rules**

The pipe reads these rules on every run. There's no separate Screenpipe-side configuration to maintain.

**Manual override**: the user can also tag any specific memory with `memorymap` in Screenpipe and the pipe will push it on the next run regardless of the source rules. After pushing, the pipe adds `memorymap-synced` so it only happens once.

To force a re-sync of an already-synced memory, the user removes the `memorymap-synced` tag from it.

---

## Rules

- Never push memories that don't match the export rules.
- Never strip tags from a memory — only ADD `memorymap-synced` after a successful push.
- Never modify memory `content` or `importance`.
- Process memories oldest-first so the graph fills in chronological order.
- If an excluded tag is on a memory, skip the memory entirely (don't try to "push without that tag").
- Sleep 200ms between pushes.
- If Memory Map is down, exit cleanly — the next scheduled run will retry.
