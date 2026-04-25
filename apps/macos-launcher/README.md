# macOS launcher

Builds `Memory Map.app` — a small `.app` bundle that starts `pnpm dev`,
waits for the web server to come up, and opens the browser. Lives in
`/Applications` (or wherever you want), shows up in Spotlight and the
Dock. Quitting the app stops the dev server.

## Build

From the repo root:

```bash
./apps/macos-launcher/build.sh
```

This produces `/Applications/Memory Map.app`. Pass an alternate
destination if you don't want to install system-wide:

```bash
./apps/macos-launcher/build.sh ~/Applications
```

The script bakes the current repo's absolute path into the launcher.
If you move the repo, re-run the build.

## Requirements

- macOS (uses `sips`, `iconutil`, and LaunchServices)
- `node@22` installed via Homebrew (`brew install node@22`).
  `better-sqlite3` doesn't have prebuilds for newer Node versions.
- `pnpm` on `PATH`

## What it does

1. Sets `PATH` to use `node@22`
2. `cd`s into the repo and runs `pnpm dev` in the background, logging
   to `~/Library/Logs/Memory Map/memory-map.log`
3. Polls `http://localhost:5173` until Vite responds
4. Opens that URL in your default browser
5. Blocks on the dev server. When you quit the app, a trap kills the
   whole dev tree.

## Files

- `build.sh` — builds the `.app` bundle
- `icon-1024.png` — icon source, gets rendered into a 10-size `.icns`
