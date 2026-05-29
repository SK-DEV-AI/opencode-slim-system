# opencode-slim-system

Reduces per-request token overhead by replacing OpenCode's bundled system prompt and built-in tool descriptions with compact versions.

Saves **~1,500 tokens/request** from the system prompt and **~8,700 tokens/request** from tool descriptions — ~10,200 total tokens saved on every request.

## How It Works

Two plugin hooks:

### `tool.definition`

Fires once per tool per session. If the tool ID matches a slim description file in `tool/{id}.txt`, replaces the stock description with the slim version. All 17 built-in OpenCode tools (v1.15.x) are covered. Non-built-in tools (from plugins like Magic Context, PTY, AFT) are left untouched.

### `experimental.chat.system.transform`

Fires when the system prompt is constructed. If the prompt looks like a bundled default (detected by markers like "best coding agent on the planet"), replaces the identity/behavior section with the content of `prompt/default.txt`. The environment block (model info, working directory, date) is preserved.

**Why a plugin hook?** OpenCode's bundled prompts are compiled into the binary as static imports. PR #7264 (which proposed `~/.config/opencode/prompt/` auto-loading) was never merged. The only way to replace the system prompt for non-Claude/non-GPT models is via this plugin hook.

## What's Included

| File | Purpose |
|------|---------|
| `tool/*.txt` | 17 slim tool descriptions (one per built-in tool) |
| `prompt/default.txt` | Slim system prompt (identity + tone, ~240 tokens) |
| `src/index.ts` | Server plugin — hooks into tool.definition and experimental.chat.system.transform |
| `tui/index.tsx` | TUI sidebar panel — shows slim count, version, update indicator |

## Sidebar Panel

Registered at sidebar order 899. Shows:

- **Tools slimmed** — count of covered built-in tools (green)
- **⬆ Update available** — when npm has a newer version (warning color, with version number)
- **Update dialog** — on first TUI start per version, shows current vs latest + GitHub releases link

Dismissed versions are persisted to `~/.local/state/opencode-slim-system/announced.json`.

## Status File

The plugin writes `/tmp/opencode-slim-system.json` at startup:

```json
{
  "plugin": "opencode-slim-system@1.1.0",
  "opencode": "1.15.12",
  "slimmed": 17,
  "tools": ["apply_patch", "bash", "edit", ...],
  "latest_version": "1.0.9",
  "update_available": true
}
```

`latest_version` and `update_available` appear after the background npm check completes (usually within 1-2 seconds).

## Customization

### System Prompt

Edit `prompt/default.txt` in the npm package:

```
~/.cache/opencode/packages/opencode-slim-system@latest/
  node_modules/opencode-slim-system/
    prompt/default.txt     ← edit this
    tool/{id}.txt          ← edit tool descriptions
```

After editing, clear the cache and restart for changes to take effect:

```bash
rm -rf ~/.cache/opencode/packages/opencode-slim-system@latest
```

**Note:** The cache persists across restarts — `rm -rf` is required every time you edit the shipped files. For persistent customization, fork this repo, publish your own npm package, and register it instead.

### Tool Descriptions

Each `tool/{id}.txt` file corresponds to a tool ID from OpenCode's registry. Edit the file to change what the model sees as that tool's description. Placeholders (`${os}`, `${shell}`, `${directory}`, etc.) are preserved from the original descriptions.

## Drift Detection

When OpenCode adds new built-in tools or changes tool IDs, the shipped `tool/*.txt` files may fall out of sync. Use the companion CLI script:

```bash
slim-plugin-check       # check coverage
slim-plugin-check --diff  # show exact add/remove/publish commands
```

The script lives at `~/.local/bin/slim-plugin-check` (not shipped with this npm package).

## Self-Update Notification

At startup, the server plugin fetches `https://registry.npmjs.org/opencode-slim-system` and compares `dist-tags.latest` against the installed version. If a newer version exists:

1. `update_available: true` and `latest_version` are written to the status file
2. The TUI sidebar shows an ⬆ indicator next to the version number
3. A dialog appears on first TUI start per version (dismiss once, silenced until next release)

No polling — the npm check runs once at startup with a 5-second timeout.

## Files on Disk

| Path | Purpose |
|------|---------|
| `/tmp/opencode-slim-system.json` | Runtime status (ephemeral) |
| `~/.local/state/opencode-slim-system/announced.json` | Last announced update version |
| `~/.cache/opencode/packages/opencode-slim-system@latest/` | Cached npm package |
| `~/.opencode/tui.json` | TUI plugin registration (adds sidebar) |
| `~/.config/opencode/tui.json` | TUI plugin registration (mirror) |
| `~/.config/opencode/opencode.jsonc` | Server plugin registration |

## Installation

```bash
# Install the plugin
npm install -g opencode-slim-system

# Or add to opencode.jsonc
```

In `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "plugin": ["opencode-slim-system"]
}
```

In `~/.opencode/tui.json` and/or `~/.config/opencode/tui.json`:

```json
{
  "plugin": ["opencode-slim-system"]
}
```

Restart OpenCode. On first TUI load you'll see a toast confirming the plugin loaded.

## Limitations

- **Cannot distinguish built-in tools from plugin tools at runtime** — The `tool.definition` hook fires for every tool in the system regardless of origin. The plugin silmply checks whether it has a slim description for the tool ID and does nothing if it doesn't. Drift detection requires the external `slim-plugin-check` script.
- **System prompt replacement uses marker heuristics** — The hook looks for strings like "best coding agent on the planet" to identify stock prompts. Custom prompts (agents with custom `.md` files) are not touched.
- **npm cache is sticky** — OpenCode never re-fetches a cached npm package. Clear `~/.cache/opencode/packages/opencode-slim-system@latest/` to force a fresh download.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    OpenCode Session                       │
│  ┌──────────────┐    ┌─────────────────────────────┐     │
│  │ System Prompt │◄───│ experimental.chat.system    │     │
│  │ Construction  │    │    .transform (fallback)    │     │
│  └──────────────┘    └───────────┬─────────────────┘     │
│                                  │ reads                  │
│  ┌──────────────┐    ┌──────────▼─────────────────┐     │
│  │ Tool Schema  │◄───│ tool.definition (per tool)  │     │
│  │ Construction │    └──────────┬─────────────────┘     │
│  └──────────────┘               │ reads                  │
│                                 │ tool/*.txt files       │
│  ┌──────────────┐               │                        │
│  │ TUI Sidebar  │◄──── polls /tmp/opencode-slim-system   │
│  │ (order 899)  │       .json every 5s                  │
│  └──────────────┘                                        │
└─────────────────────────────────────────────────────────┘
```

## License

MIT
