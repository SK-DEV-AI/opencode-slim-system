# opencode-slim-system

Replaces OpenCode's default system prompt and built-in tool descriptions with short,
token-efficient alternatives. No behavioral changes — only prose length.

## How it works

Two hooks registered into OpenCode's plugin system:

- **`experimental.chat.system.transform`** — detects the bundled system prompt
  (by recognizable markers) and swaps it for `prompt/default.txt`. Everything after
  the env block (model, directory, date, skills, AGENTS.md instructions) is preserved.

- **`tool.definition`** — fires for every tool during schema construction. If a
  slim description exists in `tool/<id>.txt`, it replaces the verbose original.
  Tool schemas and execution behavior are unchanged.

## Token savings

| Component | Before | After | Savings |
|-----------|--------|-------|---------|
| System prompt (provider text) | ~1,800 tokens | ~240 tokens | ~1,560 |
| Tool descriptions (18 built-in) | ~9,500 tokens | ~750 tokens | ~8,750 |
| **Total per request** | **~11,300 tokens** | **~990 tokens** | **~10,310** |

Tool descriptions are NOT cacheable — they are sent on every LLM turn. System
prompt text IS cacheable (Anthropic prompt caching, OpenAI cached prefix), so
the tool description savings compound on every single message.

## Installation

Load as an npm plugin in `opencode.json`:

```json
{
  "plugin": ["opencode-slim-system"]
}
```

Or as a local plugin — clone into `~/.config/opencode/plugins/opencode-slim-system/`.

## Customisation

- **System prompt**: edit `prompt/default.txt`.
- **Tool descriptions**: edit any file in `tool/` matching the tool ID
  (e.g. `tool/bash.txt`, `tool/read.txt`).

The plugin scans the `tool/` directory at startup, so new `.txt` files are
picked up automatically.

## Inspired by

- [AnthonyFangqing/opencode-special-edition](https://github.com/AnthonyFangqing/opencode-special-edition) —
  the original minimal-prompt plugin. This fork extracts the same approach into
  an independent, published package with updated tool coverage.
- [PR #24202](https://github.com/anomalyco/opencode/pull/24202) — MartinWie's
  condensed tool descriptions (unmerged).

## License

MIT
