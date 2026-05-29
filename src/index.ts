import type { Hooks } from "@opencode-ai/plugin"
import { DEFAULT_TOOL_DESCRIPTIONS, DEFAULT_SYSTEM_PROMPT } from "./defaults"
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs"
import { execSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const STATUS_FILE = "/tmp/opencode-slim-system.json"
const CACHE_DIR = path.join(os.homedir(), ".local", "state", "opencode-slim-system")
const CONFIG_DIR = path.join(os.homedir(), ".config", "opencode", "slim-system")
const CONFIG_TOOLS_DIR = path.join(CONFIG_DIR, "tool")
const CONFIG_PROMPT_FILE = path.join(CONFIG_DIR, "prompt", "default.txt")

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

/** Expand leading ~/ to os.homedir(). Node's fs methods don't do this. */
function resolveTilde(p: string): string {
  return p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p
}

function readToolsFromDir(dir: string): Record<string, string> {
  const tools: Record<string, string> = {}
  if (!existsSync(dir)) return tools
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".txt")) continue
      tools[name.slice(0, -4)] = readFileSync(path.join(dir, name), "utf-8").trimEnd()
    }
  } catch { /* best-effort */ }
  return tools
}

function readFileContent(fp: string): string {
  try { return readFileSync(fp, "utf-8").trimEnd() } catch { return "" }
}

function writeDirFromMap(dir: string, map: Record<string, string>) {
  mkdirSync(dir, { recursive: true })
  for (const [id, content] of Object.entries(map)) {
    writeFileSync(path.join(dir, `${id}.txt`), content + "\n")
  }
}

/** Seed config dir on first run AND write any missing tool files (upgrade seeding). */
function seedConfigDir() {
  const toolsExist = existsSync(CONFIG_TOOLS_DIR)
  const promptExist = existsSync(CONFIG_PROMPT_FILE)

  if (!toolsExist) {
    try {
      writeDirFromMap(CONFIG_TOOLS_DIR, DEFAULT_TOOL_DESCRIPTIONS)
    } catch { /* best-effort */ }
  } else {
    // Upgrade seeding: write any tool files present in defaults but missing from config dir.
    // This catches new tools added by opencode after the user's config dir was seeded.
    try {
      const existing = new Set(readdirSync(CONFIG_TOOLS_DIR).filter((f) => f.endsWith(".txt")))
      for (const id of Object.keys(DEFAULT_TOOL_DESCRIPTIONS)) {
        if (!existing.has(`${id}.txt`)) {
          writeFileSync(
            path.join(CONFIG_TOOLS_DIR, `${id}.txt`),
            DEFAULT_TOOL_DESCRIPTIONS[id] + "\n",
          )
        }
      }
    } catch { /* best-effort */ }
  }

  if (!promptExist) {
    try {
      mkdirSync(path.dirname(CONFIG_PROMPT_FILE), { recursive: true })
      writeFileSync(CONFIG_PROMPT_FILE, DEFAULT_SYSTEM_PROMPT + "\n")
    } catch { /* best-effort */ }
  }
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

seedConfigDir()

// Read from config dir (user-editable files in ~/.config/opencode/)
let SLIM_TOOLS = readToolsFromDir(CONFIG_TOOLS_DIR)
if (Object.keys(SLIM_TOOLS).length === 0) {
  SLIM_TOOLS = { ...DEFAULT_TOOL_DESCRIPTIONS } // embedded fallback
}

let SLIM_SYSTEM_PROMPT = readFileContent(CONFIG_PROMPT_FILE)
if (!SLIM_SYSTEM_PROMPT) {
  SLIM_SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT
}

const STATUS = buildStatus(SLIM_TOOLS)
writeStatus(STATUS)

// ─── Background npm version check (async) ───
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

export default async function plugin(
  _input: import("@opencode-ai/plugin").PluginInput,
  options?: import("@opencode-ai/plugin").PluginOptions,
): Promise<Hooks> {
  const exclude = new Set<string>(
    Array.isArray(options?.exclude) ? (options.exclude as string[]) : [],
  )
  const customTools = (options?.tools as Record<string, string> | undefined) ?? {}
  const customPrompt = typeof options?.prompt === "string" ? options.prompt : ""

  // ── reset: wipe config dir and reseed from defaults ──
  if (options?.reset === true) {
    try {
      rmSync(CONFIG_DIR, { recursive: true, force: true })
      seedConfigDir()
      // Reload module-level vars
      SLIM_TOOLS = readToolsFromDir(CONFIG_TOOLS_DIR)
      SLIM_SYSTEM_PROMPT = readFileContent(CONFIG_PROMPT_FILE)
      Object.assign(STATUS, buildStatus(SLIM_TOOLS))
      writeStatus(STATUS)
    } catch { /* best-effort */ }
  }

  // Resolve paths with tilde expansion (Node's fs doesn't expand ~)
  const toolsDir = typeof options?.toolsDir === "string" ? resolveTilde(options.toolsDir) : CONFIG_TOOLS_DIR
  const promptFile = typeof options?.promptFile === "string" ? resolveTilde(options.promptFile) : CONFIG_PROMPT_FILE

  // Auto-seed custom paths if they don't exist
  if (toolsDir !== CONFIG_TOOLS_DIR && !existsSync(toolsDir)) {
    try {
      writeDirFromMap(toolsDir, DEFAULT_TOOL_DESCRIPTIONS)
    } catch { /* best-effort */ }
  }
  if (promptFile !== CONFIG_PROMPT_FILE && !existsSync(promptFile)) {
    try {
      mkdirSync(path.dirname(promptFile), { recursive: true })
      writeFileSync(promptFile, DEFAULT_SYSTEM_PROMPT + "\n")
    } catch { /* best-effort */ }
  }

  // Read from filesystem (overrides config dir or module-level SLIM_TOOLS)
  const fsTools = readToolsFromDir(toolsDir)
  const fsPrompt = readFileContent(promptFile)

  return {
    "experimental.chat.system.transform": async (_input, output) => {
      for (let i = 0; i < output.system.length; i++) {
        const text = output.system[i]
        const isDefault = DEFAULT_PROMPT_MARKERS.some((m) => text.includes(m))
        if (!isDefault) continue

        // priority: inline > promptFile > config dir > embedded default
        const prompt = customPrompt || fsPrompt || SLIM_SYSTEM_PROMPT
        const envIdx = text.indexOf(ENV_MARKER)
        if (envIdx !== -1) {
          output.system[i] = prompt + "\n" + text.slice(envIdx)
        } else {
          output.system[i] = prompt
        }
      }
    },

    "tool.definition": async (input, output) => {
      if (exclude.has(input.toolID)) return
      // Per-model tool descriptions ({id}.{model}.txt) are not possible here because
      // ToolDefinitionInput only contains toolID — the plugin API provides no model info
      // at this hook. If opencode adds it in the future, we can branch here.
      //
      // priority: inline > toolsDir/*.txt > config dir > embedded default > stock
      const desc = customTools[input.toolID] ?? fsTools[input.toolID] ?? SLIM_TOOLS[input.toolID]
      if (desc) {
        output.description = desc
      }
    },
  }
}
