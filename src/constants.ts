import path from "node:path"
import os from "node:os"

export const STATUS_FILE = "/tmp/opencode-slim-system.json"
export const LOG_FILE = "/tmp/opencode-slim-system.log"
export const CACHE_DIR = path.join(os.homedir(), ".local", "state", "opencode-slim-system")
export const ANNOUNCED_FILE = path.join(CACHE_DIR, "announced.json")
export const CONFIG_DIR = path.join(os.homedir(), ".config", "opencode", "slim-system")
export const CONFIG_TOOLS_DIR = path.join(CONFIG_DIR, "tool")
export const CONFIG_PROMPT_DIR = path.join(CONFIG_DIR, "prompt")
export const CONFIG_PROMPT_FILE = path.join(CONFIG_PROMPT_DIR, "default.txt")

export const PLACEHOLDERS: Record<string, () => string> = {
  "{{year}}": () => new Date().getFullYear().toString(),
  "${os}": () => os.platform() === "win32" ? "windows" : os.platform() === "darwin" ? "macos" : "linux",
  "${shell}": () => path.basename(process.env.SHELL ?? "/bin/bash"),
  "${chaining}": () => "true",
  "${maxLines}": () => "4000",
  "${maxBytes}": () => "102400",
  "${directory}": () => "session worktree",
}

export const DEFAULT_PROMPT_MARKERS = [
  "best coding agent on the planet",
  "opencode, an interactive CLI tool",
  "opencode, an agent",
  "expert AI programming assistant",
  "interactive general AI agent",
]

export const ENV_MARKER = "You are powered by the model named"

export const ENV_BLOCK_MARKERS = [
  ENV_MARKER,
  "You are powered by",
  "\nInstructions from:",
  "\nHere is some useful information",
  "\nYou are a",
]

export const BASE_TOOL_IDS = [
  "apply_patch",
  "bash",
  "edit",
  "glob",
  "grep",
  "lsp",
  "plan_exit",
  "question",
  "read",
  "repo_clone",
  "repo_overview",
  "skill",
  "task",
  "todowrite",
  "webfetch",
  "websearch",
  "write",
]
