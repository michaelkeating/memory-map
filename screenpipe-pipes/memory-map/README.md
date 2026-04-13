# Memory Map pipe for Screenpipe

A Screenpipe pipe that pushes selected memories to a running Memory Map server. Everything is configured on the Screenpipe side — you don't need to open Memory Map's UI to set rules.

## Install

Copy `pipe.md` into your Screenpipe pipes directory:

```bash
mkdir -p ~/.screenpipe/pipes/memory-map
cp pipe.md ~/.screenpipe/pipes/memory-map/pipe.md
```

Restart Screenpipe (or wait for it to pick up the new pipe — it scans the directory periodically). The pipe should appear in Screenpipe's pipe list as **Memory Map Sync** and will run automatically every 30 minutes.

## Prerequisites

1. **Memory Map must be running** (default `http://localhost:3001`). The first time it starts, it writes its API key to `~/.screenpipe/memory-map.key` so this pipe can read it with no macOS permission prompts.
2. **Memory Map must have an Anthropic API key configured** (Memory Map → Settings → API key). Without it, the push endpoint will succeed but auto-organizing won't run.

No other Memory Map configuration is required. In particular, you do **not** need to open Memory Map → Connectors → Screenpipe. That connector is a separate feature (Memory Map polling Screenpipe); the pipe and the connector are independent.

## Configure what gets pushed

Create `~/.screenpipe/memory-map-rules.json` with the Screenpipe sources you want exported:

```json
{
  "enabledSources": [
    { "source": "digital-clone", "excludedTags": ["private", "draft"] },
    { "source": "personal-crm", "excludedTags": [] }
  ]
}
```

Each entry:
- `source` — the Screenpipe source name (the `source` field on a Screenpipe memory)
- `excludedTags` — memories from this source that carry any of these tags are skipped

Edit the file any time. The pipe re-reads it on every run.

If the file doesn't exist, the pipe runs in **manual-only mode** (see next section).

## Mark a specific memory for sync (no rules file needed)

You can bypass `enabledSources` entirely by tagging a memory with `memorymap` in Screenpipe. The pipe picks up anything tagged `memorymap` on every run, regardless of source rules — this works even with no rules file at all.

After a successful push, the pipe adds the `memorymap-synced` tag so the memory doesn't get pushed twice. To re-sync a memory (e.g. after editing it), remove the `memorymap-synced` tag.

## Troubleshooting

- **Pipe doesn't appear in Screenpipe**: make sure the file is at `~/.screenpipe/pipes/memory-map/pipe.md` exactly. Restart Screenpipe.
- **Pipe prints `NO_API_KEY`**: Memory Map hasn't started yet (or failed on startup). Launch Memory Map — on first run it writes `~/.screenpipe/memory-map.key`.
- **Pipe runs but prints `NO_DATA`**: no candidate memories. Check that `~/.screenpipe/memory-map-rules.json` names an actual Screenpipe source, or tag a memory with `memorymap` for a one-shot test.
- **Push fails with "connection refused"**: Memory Map server isn't running. Start it from the Memory Map repo.
- **Memory was pushed but the graph looks empty**: Memory Map's auto-organizer runs the push through an LLM. If no Anthropic API key is configured (Memory Map → Settings), the raw source is stored but no pages/connections are generated. Add a key and the next push will organize properly.

## Relationship to the Memory Map Screenpipe connector

Memory Map also has a built-in Screenpipe connector (Memory Map → Connectors → Screenpipe) that polls Screenpipe on a schedule and pulls memories in. That's a different mechanism in the opposite direction.

- **This pipe** (push): runs inside Screenpipe, reads `~/.screenpipe/memory-map-rules.json`, pushes to Memory Map.
- **The connector** (pull): runs inside Memory Map, has its own filter config in the Connectors panel, pulls from Screenpipe.

You can run one, the other, or both. Memory Map's ingestion is idempotent on the Screenpipe memory ID, so if both paths push the same memory, you get one page — not a duplicate. Use whichever matches your workflow; they don't conflict.
