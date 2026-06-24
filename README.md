# opencode-slim-system

Replaces OpenCode's bundled system prompt and built-in tool descriptions with compact versions to reduce per-request token overhead.

Saves roughly **~3,160 tokens/request** from tool descriptions and **~1,890 tokens/request** from the system prompt — ~5,050 total (estimated at ~4:1 chars/token ratio, varies by tokenizer). Exact savings depend on your OpenCode version and model.

## How It Works

Two plugin hooks plus a TUI sidebar:

### `tool.definition`

Replaces each built-in tool's description with a slim version from `~/.config/opencode/slim-system/tool/{id}.txt`. Covers 15 OpenCode built-in tools. Plugin and MCP tools are left untouched.

### `experimental.chat.system.transform`

Replaces the stock system prompt with `~/.config/opencode/slim-system/prompt/default.txt`. Detects stock prompts by marker strings (e.g. "best coding agent on the planet"). The environment block (model info, directory, date) is preserved. Custom agent prompts without markers are not affected.

**Why hooks and not file overrides:** OpenCode's built-in prompts and tool descriptions are compiled into the binary. There is no filesystem override. The plugin hook is the only way to swap them.

## What's Included

| File | Purpose |
|------|---------|
| `tool/*.txt` | 15 slim tool descriptions |
| `prompt/default.txt` | Slim system prompt (~240 tokens) |
| `src/index.ts` | Server plugin — hooks into tool.definition and experimental.chat.system.transform |
| `tui/index.tsx` | TUI sidebar — shows slim count, version, update indicator |
| `src/defaults.ts` | Embedded fallback defaults (auto-generated) |
| `tests/core.test.ts` | 34 tests covering parsing, resolution, I/O, integrity |

## Sidebar Panel

Registered at sidebar order 899. Shows:

- **Tools slimmed** — count of covered built-in tools (15 on stock OpenCode)
- **Token savings** — estimated per-request (approximate, labeled `~`)
- **⬆ Update available** — when npm has a newer version
- **plugin not loaded** — shown briefly before the server plugin writes its status file (normal)
- **Update dialog** — on first TUI start per version, shows current vs latest + GitHub releases link

## Status File

The server plugin writes `/tmp/opencode-slim-system.json` at startup. The TUI sidebar polls it every 5 seconds. A background npm check updates `latest_version` and `update_available` fields within 1-2 seconds.

## Per-model customization

The plugin reads the current model from `opencode.jsonc` and extracts the model key (the short name after the last `/`):

| Full model ID | Model key |
|---|---|
| `opencode/deepseek-v4-flash-free` | `deepseek-v4-flash-free` |
| `opencode/claude-sonnet-4` | `claude-sonnet-4` |

**Per-model tool descriptions:** Create `{toolID}.{modelKey}.txt` files. `bash.claude-sonnet-4.txt` activates when `opencode/claude-sonnet-4` is active. Falls back to `bash.txt` for all other models.

**Per-model system prompts:** Create `prompt/{modelKey}.txt`. Takes precedence over `prompt/default.txt` when running that model.

## Configuration

```jsonc
{
  "plugin": [
    ["opencode-slim-system", {
      "exclude": ["websearch"],
      "toolsDir": "/home/user/.config/opencode/slim-tools/"
    }]
  ]
}
```

### Options

| Key | Type | Description |
|-----|------|-------------|
| `reset` | `boolean` | Wipes config directory and reseeds from embedded defaults on next restart |
| `exclude` | `string[]` | Tool IDs to keep at original stock descriptions |
| `tools` | `Record<string, string>` | Inline description overrides for any tool ID |
| `toolsDir` | `string` | Custom path for `{id}.txt` files (default: `~/.config/opencode/slim-system/tool/`) |

**Priority chain:** `options.tools[toolID]` → `toolsDir/{toolID}.{modelKey}.txt` → `toolsDir/{toolID}.txt` → config dir → embedded defaults → stock.

## Customization

Edit any `.txt` file in `~/.config/opencode/slim-system/tool/` or `prompt/default.txt` and restart OpenCode. Changes persist across npm updates. Placeholders (`${os}`, `${shell}`, `${chaining}`, etc.) are resolved at runtime.

To reset a file to default, delete it and restart — the plugin re-seeds from its embedded defaults.

## Drift Detection

When OpenCode adds new built-in tools or changes tool IDs, the shipped `tool/*.txt` files may fall out of sync.

```bash
# From the repo clone
./slim-plugin-check          # check coverage
./slim-plugin-check --diff   # show add/remove commands

# Via npm
npx opencode-slim-check
```

A CI workflow (`.github/workflows/drift-check.yml`) runs weekly and opens an issue if drift is detected.

## CLI Commands

| Command | Description |
|---------|-------------|
| `opencode-slim-export` | Export config dir as JSON. `npx opencode-slim-export > backup.json` |
| `opencode-slim-import <file>` | Import JSON blob into config dir. `npx opencode-slim-import backup.json` |
| `opencode-slim-dump` | Dump embedded defaults as JSON (ignores user edits). |
| `opencode-slim-check` | Drift check (same as `./slim-plugin-check`) |

## Limitations

- **Token savings are approximate.** The 4:1 chars-to-token ratio varies by tokenizer. The `STOCK_TOOL_CHARS` baseline is measured from OpenCode v1.17.9 template files; newer versions may have different stock description lengths.
- **`slimmed` count shows config dir files, not runtime coverage.** The sidebar shows 15 files in the config dir. Actual tools slimmed depends on your experimental flags (lsp, plan_exit are conditional; tools without those flags enabled will have stock descriptions but still count toward the 15). The real number may be 13-14 depending on your config.
- **Drift detection is a maintainer tool.** `npx opencode-slim-check` is for repo maintainers, not end users. The plugin works fine without it.
- **System prompt replacement uses marker heuristics.** Custom prompts (agents with `.md` files) are not touched.
- **`plan_exit`, `lsp`, `question` are conditional tools.** They only exist in the tool registry when the corresponding experimental flags are enabled. Our tool descriptions for them cover all cases, but they're not always active.

## Files on Disk

| Path | Purpose |
|------|---------|
| `~/.config/opencode/slim-system/tool/` | User-editable slim tool descriptions (auto-seeded) |
| `~/.config/opencode/slim-system/prompt/default.txt` | User-editable slim system prompt (auto-seeded) |
| `/tmp/opencode-slim-system.json` | Runtime status (ephemeral) |
| `~/.local/state/opencode-slim-system/announced.json` | Last announced update version |

## Installation

```bash
npm install -g opencode-slim-system
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

## License

MIT
