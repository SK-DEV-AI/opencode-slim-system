# opencode-slim-system

Reduces per-request token overhead by replacing OpenCode's bundled system prompt and built-in tool descriptions with compact versions.

Saves **~1,400 tokens/request** from the system prompt and **~8,300 tokens/request** from tool descriptions — ~9,700 total tokens saved on every request.

## How It Works

Two plugin hooks:

### `tool.definition`

Fires once per tool per session. If the tool ID has a slim description in `~/.config/opencode/slim-system/tool/{id}.txt`, replaces the stock description with the slim version. All 17 built-in OpenCode tools (v1.15.x) are covered (some are conditional on experimental flags). Non-built-in tools (from plugins like Magic Context, PTY, AFT) are left untouched.

### `experimental.chat.system.transform`

Fires when the system prompt is constructed. If the prompt looks like a bundled default (detected by markers like "best coding agent on the planet"), replaces it with the content of `~/.config/opencode/slim-system/prompt/default.txt`. The environment block (model info, working directory, date) is preserved.

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
  "model": "opencode/deepseek-v4-flash-free",
  "model_key": "deepseek-v4-flash-free",
  "plugin": "opencode-slim-system@2.0.5",
  "opencode": "1.15.12",
  "slimmed": 17,
  "tools": ["apply_patch", "bash", "edit", ...],
  "latest_version": "2.0.5"
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
      // Note: Node's fs doesn't expand ~ — use absolute or relative paths.
      // For home-relative, use the env var ${HOME}/.config/...
      "toolsDir": "/home/user/.config/opencode/slim-tools/",
      "promptFile": "/home/user/.config/opencode/my-prompt.txt"
    }]
  ]
}
```

### Options

| Key | Type | Description |
|-----|------|-------------|
| `reset` | `boolean` | When true, wipes the config directory and reseeds from embedded defaults on next restart |
| `exclude` | `string[]` | Tool IDs to keep at original stock descriptions |
| `tools` | `Record<string, string>` | Inline description overrides for **any** tool ID (built-in or plugin) |
| `prompt` | `string` | Inline system prompt override |
| `toolsDir` | `string` | Custom path to a directory of `{id}.txt` files (default: `~/.config/opencode/slim-system/tool/`) |
| `promptFile` | `string` | Custom path to a system prompt file (default: `~/.config/opencode/slim-system/prompt/default.txt`) |

**Priority chain (tools):** `options.tools[toolID]` → `toolsDir/{id}.{model}.txt` → `toolsDir/{id}.txt` → config dir → embedded default → original stock

**Priority chain (system prompt):** `options.prompt` → `promptFile` → config dir `prompt/{model}.txt` → config dir `prompt/default.txt` → embedded default

### Per-model customization

The plugin reads the current model from `opencode.jsonc` (`model` field, e.g. `opencode/deepseek-v4-flash-free`) at startup and extracts the **model key** — the short name after the last `/`:

| Full model ID | Model key |
|---|---|
| `opencode/deepseek-v4-flash-free` | `deepseek-v4-flash-free` |
| `opencode/claude-sonnet-4` | `claude-sonnet-4` |
| `opencode/gpt-5.4-pro` | `gpt-5.4-pro` |

This avoids path separator issues — `opencode/` as a directory prefix would create nested directories.

**Per-model tool descriptions:** Create `{toolID}.{model}.txt` files. `bash.claude-sonnet-4.txt` activates when `opencode/claude-sonnet-4` is the current model. Falls back to generic `bash.txt` for all other models.

**Per-model system prompts:** Create `prompt/{model}.txt` files (next to `prompt/default.txt`). `prompt/deepseek-v4-flash-free.txt` replaces the default prompt only when running that model. Models without a per-model file use the default.

Only models with explicit customization are affected — no pollution, no need to override all models.

### Default config directory

No config needed — just add the plugin to your `opencode.jsonc`:

```jsonc
{
  "plugin": ["opencode-slim-system"]
}
```

On first run, the plugin creates `~/.config/opencode/slim-system/tool/` and `~/.config/opencode/slim-system/prompt/default.txt` with all slim descriptions. Files live outside the npm cache and survive updates. Edit any file — changes apply on next restart.

Use `toolsDir` and `promptFile` only if you want the files somewhere else.

## Customization

### System Prompt

Edit `~/.config/opencode/slim-system/prompt/default.txt` and restart OpenCode. Changes persist across npm updates.

### Tool Descriptions

Edit any `*.txt` file in `~/.config/opencode/slim-system/tool/`. Each file corresponds to a tool ID from OpenCode's registry. Restart OpenCode to apply changes. Placeholders (`${os}`, `${shell}`, `${directory}`, etc.) are preserved from the original descriptions.

No npm cache clearance needed — files are read fresh on every session. To reset a file to default, delete it and restart; the plugin re-creates it from its embedded defaults.

## Drift Detection

When OpenCode adds new built-in tools or changes tool IDs, the shipped `tool/*.txt` files may fall out of sync. The repo ships `slim-plugin-check` (bash, no deps) for maintainers:

```bash
# From the repo clone
./slim-plugin-check          # check coverage
./slim-plugin-check --diff   # show add/remove/publish commands

# Or via npx (npm-installed)
npx opencode-slim-check
```

A CI workflow (`.github/workflows/drift-check.yml`) runs weekly and opens an issue if drift is detected.

## Self-Update Notification

At startup, the server plugin fetches `https://registry.npmjs.org/opencode-slim-system` and compares `dist-tags.latest` against the installed version. If a newer version exists:

1. `update_available: true` and `latest_version` are written to the status file
2. The TUI sidebar shows an ⬆ indicator next to the version number
3. A dialog appears on first TUI start per version (dismiss once, silenced until next release)

No polling — the npm check runs once at startup with a 5-second timeout.

## CLI Commands

These are available via `npx opencode-slim-<cmd>` when the package is installed globally, or directly from the repo clone.

| Command | Description |
|---------|-------------|
| `opencode-slim-export` | Export config dir as JSON. `npx opencode-slim-export > backup.json` |
| `opencode-slim-import <file>` | Import JSON blob into config dir. `npx opencode-slim-import backup.json` |
| `opencode-slim-dump` | Dump embedded defaults as JSON (ignores user edits). Add `--config-dir` to dump the actual config dir instead. |
| `opencode-slim-check` | Drift check (same as `./slim-plugin-check` in the repo) |

## Files on Disk

| Path | Purpose |
|------|---------|
| `~/.config/opencode/slim-system/tool/` | User-editable slim tool descriptions (auto-seeded) |
| `~/.config/opencode/slim-system/prompt/default.txt` | User-editable slim system prompt (auto-seeded) |
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

- **`slimmed` count is config dir files, not runtime coverage** — The sidebar shows all 17 files in `~/.config/opencode/slim-system/tool/`. Actual tools slimmed depends on your experimental flags (`lsp`, `plan_exit`, `repo_clone`, etc. are conditional). For users without those flags enabled, the real count is ~14-15. The TUI always shows the larger number.
- **Drift detection is a maintainer tool** — `npx opencode-slim-check` is aimed at repo maintainers, not end users. Most users never need it; the plugin works fine as-is.

- **System prompt replacement uses marker heuristics** — The hook looks for strings like "best coding agent on the planet" to identify stock prompts. Custom prompts (agents with custom `.md` files) are not touched.

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
