import type { Hooks } from "@opencode-ai/plugin"
import { readSlimSystemPrompt, readSlimToolDescriptions } from "./read-content"
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { execSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const STATUS_FILE = "/tmp/opencode-slim-system.json"
const CACHE_DIR = path.join(os.homedir(), ".local", "state", "opencode-slim-system")

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

function semverGt(a: string, b: string): boolean {
  const pa = a.split(".").map(Number)
  const pb = b.split(".").map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false
  }
  return false
}

function buildStatus(tools: Record<string, string>): Record<string, unknown> {
  return {
    plugin: `opencode-slim-system@${getPluginVersion()}`,
    opencode: getOpencodeVersion(),
    slimmed: Object.keys(tools).length,
    tools: Object.keys(tools),
  }
}

function writeStatus(s: Record<string, unknown>) {
  try { writeFileSync(STATUS_FILE, JSON.stringify(s, null, 2)) } catch { /* best-effort */ }
}

async function checkLatestVersion(): Promise<string | undefined> {
  try {
    const response = await fetch("https://registry.npmjs.org/opencode-slim-system", {
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return undefined
    const data = (await response.json()) as { "dist-tags"?: { latest?: string } }
    return data?.["dist-tags"]?.latest
  } catch {
    return undefined
  }
}

function loadAnnouncedVersion(): string | undefined {
  try {
    const file = path.join(CACHE_DIR, "announced.json")
    if (!existsSync(file)) return undefined
    return JSON.parse(readFileSync(file, "utf-8")).version
  } catch {
    return undefined
  }
}

function saveAnnouncedVersion(version: string) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true })
    writeFileSync(path.join(CACHE_DIR, "announced.json"), JSON.stringify({ version }))
  } catch { /* best-effort */ }
}

// ─── Module init (sync) ───

const SLIM_SYSTEM_PROMPT = initSlimPrompt()
const SLIM_TOOLS = initSlimTools()
const STATUS = buildStatus(SLIM_TOOLS)
writeStatus(STATUS)

// ─── Background npm version check (async) ───
// Updates STATUS and rewrites the status file once the check completes.
// TUI polls the file every 5s so the update info appears without a restart.
const pluginVersion = getPluginVersion()
checkLatestVersion().then((latest) => {
  if (latest && semverGt(latest, pluginVersion)) {
    STATUS.latest_version = latest
    STATUS.update_available = true
  } else {
    STATUS.latest_version = latest ?? pluginVersion
  }
  writeStatus(STATUS)
})

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
      }
    },
  }
}
