# opencode-slim-system

Reduces per-request token overhead by replacing OpenCode's bundled system prompt and built-in tool descriptions with compact versions.

Saves **~1,400 tokens/request** from the system prompt and **~8,300 tokens/request** from tool descriptions — ~9,700 total tokens saved on every request.

## How It Works

Two plugin hooks:

### `tool.definition`

Fires once per tool per session. If the tool ID matches a slim description file in `tool/{id}.txt`, replaces the stock description with the slim version. All 17 built-in OpenCode tools (v1.15.x) are covered (some are conditional on experimental flags). Non-built-in tools (from plugins like Magic Context, PTY, AFT) are left untouched.

### `experimental.chat.system.transform`

Fires when the system prompt is constructed. If the prompt looks like a bundled default (detected by markers like "best coding agent on the planet"), replaces it with the content of `prompt/default.txt`. The environment block (model info, working directory, date) is preserved.

**Why a plugin hook is necessary:** OpenCode's prompts are compiled into the binary as static imports (`packages/opencode/src/session/system.ts` — model matching chooses one of `anthropic.txt`, `beast.txt`, `gpt.txt`, `gemini.txt`, `codex.txt`, `trinity.txt`, `kimi.txt`, or `default.txt`). There is no built-in filesystem override — the `~/.config/opencode/prompt/` feature proposed in PR #7264 was closed without merging. The plugin hook is the **only** way to replace the system prompt for models that don't match Claude/GPT patterns.

## What's Included

| File | Purpose |
|------|---------|
| `tool/*.txt` | 17 slim tool descriptions (one per built-in tool — some are conditional on experimental flags) |
| `prompt/default.txt` | Slim system prompt (identity + tone, ~240 tokens) |
| `src/index.ts` | Server plugin — hooks into tool.definition and experimental.chat.system.transform |
| `tui/index.tsx` | TUI sidebar panel — shows slim count, version, update indicator |

## Sidebar Panel

Registered at sidebar order 899. Shows:

- **Tools slimmed** — count of covered built-in tools (green)
- **⬆ Update available** — when npm has a newer version (warning color, with version number)
- **plugin not loaded** — shown briefly before the server plugin writes its status file (normal on first load)
- **Update dialog** — on first TUI start per version, shows current vs latest + GitHub releases link

Dismissed versions are persisted to `~/.local/state/opencode-slim-system/announced.json`.

## Status File

The server plugin writes `/tmp/opencode-slim-system.json` at startup:

```json
{
  "plugin": "opencode-slim-system@1.1.6",
  "opencode": "1.15.12",
  "slimmed": 17,
  "tools": ["apply_patch", "bash", "edit", ...],
  "latest_version": "1.1.6"
}
```

The TUI sidebar polls this file every 5 seconds. It ignores stale files from a
previous npm version (compares the embedded `plugin` version against its own
installed version). When a fresh file appears after a session starts, the
sidebar updates and a startup toast fires once.

`latest_version` appears after the background npm check completes (usually
within 1-2 seconds). If a newer version exists, `update_available: true` is
also written to the file and the sidebar shows an ⬆ indicator.

## Configuration

Plugin options are set via the array syntax in `opencode.jsonc`:

```jsonc
{
  "plugin": [
    ["opencode-slim-system", {
      "exclude": ["websearch"],
      "tools": {
        "bash": "Run shell commands with full interactive PTY support."
      },
      "prompt": "You are opencode, an interactive CLI tool..."
    }]
  ]
}
```

### Options

| Key | Type | Description |
|-----|------|-------------|
| `exclude` | `string[]` | Tool IDs to keep at original stock descriptions |
| `tools` | `Record<string, string>` | Inline description overrides for **any** tool ID (built-in or plugin) |
| `prompt` | `string` | Inline system prompt override |
| `toolsDir` | `string` | Path to a directory of `{id}.txt` files — same format as shipped `tool/`. Read at plugin start, survives npm updates. |
| `promptFile` | `string` | Path to a `default.txt`-format system prompt file. Read at plugin start, survives npm updates. |

**Priority chain (tools):** `options.tools[toolID]` → `toolsDir/{id}.txt` → shipped `tool/{id}.txt` → original stock

**Priority chain (prompt):** `options.prompt` → `promptFile` → shipped `prompt/default.txt`

Inline options (`tools`/`prompt`) win over files, files win over bundled, bundled wins over original stock. Helps keep long text in real files instead of JSON.

Use `toolsDir` and `promptFile` when your descriptions are too long for inline JSON. Both paths are absolute or relative to the opencode working directory.

### Auto-seeding

If `toolsDir` points to a directory that doesn't exist yet, the plugin creates it on first run and copies all bundled `tool/*.txt` files into it as editable starting material. Same for `promptFile` — if the file doesn't exist, the bundled prompt is written there.

Your copies take priority over the bundled ones (per the priority chain) and survive npm updates since they're outside the npm cache. Any tool you don't edit keeps the slim description you already know.

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

When OpenCode adds new built-in tools or changes tool IDs, the shipped `tool/*.txt` files may fall out of sync. The repo ships `slim-plugin-check` (bash, no deps) for maintainers:

```bash
git clone https://github.com/SK-DEV-AI/opencode-slim-system
cd opencode-slim-system
./slim-plugin-check          # check coverage
./slim-plugin-check --diff   # show add/remove/publish commands
```

Not available from npm — clone the repo to use it. Most users don't need this; the plugin works fine as-is.

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

- **`slimmed` count is shipped files, not runtime coverage** — The sidebar shows all 17 shipped description files. Actual tools slimmed depends on your experimental flags (`lsp`, `plan_exit`, `repo_clone`, etc. are conditional). For users without those flags enabled, the real count is ~14-15. The TUI always shows the larger number.
- **Drift detection requires repo clone** — The plugin no longer attempts to track missing tool descriptions (too many false positives from plugin tools). Clone the repo and run `./slim-plugin-check --diff` after an OpenCode update to see if new built-in tools need slim descriptions.
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
