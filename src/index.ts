import type { Hooks } from "@opencode-ai/plugin"
import { readSlimSystemPrompt, readSlimToolDescriptions } from "./read-content"
import { readFileSync, writeFileSync } from "node:fs"
import { execSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const STATUS_FILE = "/tmp/opencode-slim-system.json"
// Internal tools that fire the hook but we don't slim
const SKIP_TOOL_IDS = new Set(["invalid"])

function getPluginVersion(): string {
  try {
    const pkg = readFileSync(path.join(PLUGIN_ROOT, "package.json"), "utf-8")
    return JSON.parse(pkg).version ?? "unknown"
  } catch {
    return "unknown"
  }
}

function getOpencodeVersion(): string {
  try {
    return execSync("opencode --version", { encoding: "utf-8", timeout: 3000 }).trim()
  } catch {
    return "unknown"
  }
}

function buildStatus(tools: Record<string, string>): { plugin: string; opencode: string; slimmed: number; tools: string[]; missing: string[] } {
  return {
    plugin: `opencode-slim-system@${getPluginVersion()}`,
    opencode: getOpencodeVersion(),
    slimmed: Object.keys(tools).length,
    tools: Object.keys(tools),
    missing: [],
  }
}

function writeStatus(s: Record<string, unknown>) {
  try { writeFileSync(STATUS_FILE, JSON.stringify(s, null, 2)) } catch { /* best-effort */ }
}

function initSlimPrompt(): string {
  try {
    return readSlimSystemPrompt()
  } catch {
    console.warn("[opencode-slim-system] prompt/default.txt not found")
    return ""
  }
}

function initSlimTools(): Record<string, string> {
  try {
    return readSlimToolDescriptions()
  } catch {
    console.warn("[opencode-slim-system] tool/ directory not found")
    return {}
  }
}

const SLIM_SYSTEM_PROMPT = initSlimPrompt()
const SLIM_TOOLS = initSlimTools()
// Don't call initSlimTools() again — reuse SLIM_TOOLS
const STATUS = buildStatus(SLIM_TOOLS)
writeStatus(STATUS)

const ENV_MARKER = "You are powered by the model named"
const DEFAULT_PROMPT_MARKERS = [
  "best coding agent on the planet",
  "opencode, an interactive CLI tool",
  "opencode, an agent",
  "expert AI programming assistant",
  "interactive general AI agent",
]

export default async function plugin(): Promise<Hooks> {
  return {
    "experimental.chat.system.transform": async (_input, output) => {
      for (let i = 0; i < output.system.length; i++) {
        const text = output.system[i]
        const isDefault = DEFAULT_PROMPT_MARKERS.some((m) => text.includes(m))
        if (!isDefault) continue

        const envIdx = text.indexOf(ENV_MARKER)
        if (envIdx !== -1) {
          output.system[i] = SLIM_SYSTEM_PROMPT + "\n" + text.slice(envIdx)
        } else {
          output.system[i] = SLIM_SYSTEM_PROMPT
        }
      }
    },

    "tool.definition": async (input, output) => {
      const slim = SLIM_TOOLS[input.toolID]
      if (slim) {
        output.description = slim
      } else if (!SKIP_TOOL_IDS.has(input.toolID)) {
        if (!STATUS.missing.includes(input.toolID)) {
          STATUS.missing.push(input.toolID)
          writeStatus(STATUS)
        }
      }
    },
  }
}
