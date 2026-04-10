# Memory Map pipe for Screenpipe

A Screenpipe pipe that pushes selected memories to a running Memory Map server. Lets you curate from inside Screenpipe which memories should become nodes in your knowledge graph.

## Install

Copy `pipe.md` into your Screenpipe pipes directory:

```bash
mkdir -p ~/.screenpipe/pipes/memory-map
cp pipe.md ~/.screenpipe/pipes/memory-map/pipe.md
```

Restart Screenpipe (or wait for it to pick up the new pipe — it scans the directory periodically). The pipe should appear in Screenpipe's pipe list as **Memory Map Sync**, and it'll run automatically every 30 minutes.

## How to mark a memory for sync

You have two ways to tell the pipe "send this memory to Memory Map":

### 1. Tag a memory with `memorymap`

Open any existing memory in Screenpipe and add the `memorymap` tag. On the next scheduled run, the pipe will push it to Memory Map.

### 2. Create a memory with `source: memory-map`

If you (or another pipe) creates a memory and sets its source to `memory-map`, the pipe will pick it up automatically.

After a successful push, the pipe adds the `memorymap-synced` tag to the memory so it doesn't get pushed twice. If you want to re-sync (e.g. after editing the memory), remove the `memorymap-synced` tag.

## Configuration

The pipe assumes Memory Map is running on `http://localhost:3001` and Screenpipe is on `http://localhost:3030` (the defaults). If you've changed those, edit the URLs in `pipe.md`.

## Troubleshooting

- **Pipe doesn't appear in Screenpipe**: make sure the file is at `~/.screenpipe/pipes/memory-map/pipe.md` exactly. Restart Screenpipe.
- **Pipe runs but doesn't push anything**: check that you've actually tagged a memory with `memorymap` (not `memory-map` — note the lack of dash). Visit `http://localhost:3030/memories?tags=memorymap` in your browser to verify.
- **Push fails with "connection refused"**: Memory Map server isn't running. Start it with `pnpm --filter @memory-map/server dev` from the Memory Map repo.
- **Memory shows as "Imported" in the Memory Map browser but the pipe keeps pushing it**: the pipe failed to add the `memorymap-synced` tag. Check Screenpipe's tag-add API endpoint format and update Step 4 of `pipe.md` accordingly.

## How it complements the Memory Map side

This pipe is the **Screenpipe-side** way to control what flows into Memory Map. The Memory Map app also has its own controls:

- **Connector filters** (Configure → Source filter / Tag filter): the Memory Map server polls Screenpipe and pulls only memories that match.
- **Memory Browser** (Connectors → Browse memories): a UI that lists all Screenpipe memories with manual import buttons.

The pipe adds a third option: **mark from inside Screenpipe** and the pipe pushes them. Useful when you're already in Screenpipe and don't want to switch contexts.
