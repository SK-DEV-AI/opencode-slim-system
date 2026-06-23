import type { Hooks } from "@opencode-ai/plugin"
import { DEFAULT_TOOL_DESCRIPTIONS, DEFAULT_SYSTEM_PROMPT } from "./defaults"
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs"
import { execSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const STATUS_FILE = "/tmp/opencode-slim-system.json"
const LOG_FILE = "/tmp/opencode-slim-system.log"

function log(msg: string) {
  try { appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`) } catch { /* best-effort */ }
}
const CACHE_DIR = path.join(os.homedir(), ".local", "state", "opencode-slim-system")
const CONFIG_DIR = path.join(os.homedir(), ".config", "opencode", "slim-system")
const CONFIG_TOOLS_DIR = path.join(CONFIG_DIR, "tool")
const CONFIG_PROMPT_DIR = path.join(CONFIG_DIR, "prompt")
const CONFIG_PROMPT_FILE = path.join(CONFIG_PROMPT_DIR, "default.txt")

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

/** Read the current model from opencode.jsonc (handles JSONC comments properly). */
function getCurrentModel(): string {
  try {
    const configPath = path.join(os.homedir(), ".config", "opencode", "opencode.jsonc")
    const raw = readFileSync(configPath, "utf-8")
    // Strip block comments /* ... */
    let cleaned = raw.replace(/\/\*[\s\S]*?\*\//g, "")
    // Strip // comments outside of strings (character-by-character to handle URLs in quotes)
    const lines = cleaned.split("\n")
    cleaned = lines.map((line) => {
      let inString = false
      for (let i = 0; i < line.length - 1; i++) {
        if (line[i] === '"' && (i === 0 || line[i - 1] !== "\\")) inString = !inString
        if (!inString && line[i] === "/" && line[i + 1] === "/") return line.slice(0, i)
      }
      return line
    }).join("\n")
    return JSON.parse(cleaned).model ?? "unknown"
  } catch {
    return "unknown"
  }
}

/** Convert a full model ID (e.g. "opencode/deepseek-v4-flash-free") to a filesystem-safe key.
 *  Strips everything before the last "/" so filenames don't create nested dirs. */
function modelToKey(model: string): string {
  const idx = model.lastIndexOf("/")
  return idx >= 0 ? model.slice(idx + 1) : model
}

/** Resolve runtime placeholders that stock opencode renders dynamically but our
 *  static descriptions bypass. Stock tools use getters/render functions that
 *  we bypass via `tool.definition` hook replacement. */
function resolvePlaceholders(text: string): string {
  const year = new Date().getFullYear().toString()
  const plat = os.platform() === "win32" ? "windows" : os.platform() === "darwin" ? "macos" : "linux"
  const sh = path.basename(process.env.SHELL ?? "/bin/bash")
  return text.replace(/\{\{year\}\}/g, year).replace(/\$\{os\}/g, plat).replace(/\$\{shell\}/g, sh)
}

/** Distinguish base tool IDs from per-model variants (e.g. `bash.claude-sonnet-4`).
 *  A key is a base tool if it does NOT end with `.${MODEL_KEY}`. */
function isBaseTool(key: string): boolean {
  return !key.endsWith(`.${MODEL_KEY}`)
}

function readToolsFromDir(dir: string): Record<string, string> {
  const tools: Record<string, string> = {}
  if (!existsSync(dir)) return tools
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".txt")) continue
      tools[name.slice(0, -4)] = resolvePlaceholders(readFileSync(path.join(dir, name), "utf-8").trimEnd())
    }
  } catch { /* best-effort */ }
  return tools
}

function writeDirFromMap(dir: string, map: Record<string, string>) {
  mkdirSync(dir, { recursive: true })
  for (const [id, content] of Object.entries(map)) {
    writeFileSync(path.join(dir, `${id}.txt`), content + "\n")
  }
}

/** Seed config dir on first run AND write any missing tool files (upgrade seeding).
 *  To permanently exclude a tool from slimming, use the `exclude` option in
 *  opencode.jsonc — deleting files from the config dir is not supported (they
 *  get recreated on next restart if present in embedded defaults). */
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
      mkdirSync(CONFIG_PROMPT_DIR, { recursive: true })
      writeFileSync(CONFIG_PROMPT_FILE, DEFAULT_SYSTEM_PROMPT + "\n")
    } catch { /* best-effort */ }
  }
}

// Stock (original opencode) tool description character totals for token savings estimate.
// Measured from opencode v1.17.9 stock tool description files (17 registered tools).
// We use a fixed ~4:1 chars/token ratio for estimate accuracy.
const STOCK_TOOL_CHARS = 16395

function buildStatus(tools: Record<string, string>): Record<string, unknown> {
  const baseToolIds = Object.keys(tools).filter(isBaseTool)
  const slimChars = baseToolIds.reduce((sum, k) => sum + (tools[k]?.length ?? 0), 0)
  const tokensSaved = Math.round((STOCK_TOOL_CHARS - slimChars) / 4)
  return {
    model: CURRENT_MODEL,
    model_key: MODEL_KEY,
    plugin: `opencode-slim-system@${getPluginVersion()}`,
    opencode: getOpencodeVersion(),
    slimmed: baseToolIds.length,
    tokensSaved,
    tools: baseToolIds,
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

// Detect current model from opencode.jsonc for per-model description lookups
const CURRENT_MODEL = getCurrentModel()
const MODEL_KEY = modelToKey(CURRENT_MODEL) // safe for filenames (strips provider prefix)

// Read from config dir (user-editable files in ~/.config/opencode/)
let SLIM_TOOLS = readToolsFromDir(CONFIG_TOOLS_DIR)
if (Object.keys(SLIM_TOOLS).length === 0) {
  SLIM_TOOLS = { ...DEFAULT_TOOL_DESCRIPTIONS } // embedded fallback
}

let SLIM_SYSTEM_PROMPT: string
try { SLIM_SYSTEM_PROMPT = readFileSync(CONFIG_PROMPT_FILE, "utf-8").trimEnd() } catch { SLIM_SYSTEM_PROMPT = "" }
if (!SLIM_SYSTEM_PROMPT) {
  SLIM_SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT
}
let SLIM_SYSTEM_PROMPT_MODEL: string
try { SLIM_SYSTEM_PROMPT_MODEL = readFileSync(path.join(CONFIG_PROMPT_DIR, `${MODEL_KEY}.txt`), "utf-8").trimEnd() } catch { SLIM_SYSTEM_PROMPT_MODEL = "" }

const STATUS = buildStatus(SLIM_TOOLS)
writeStatus(STATUS)

const allToolIds = Object.keys(SLIM_TOOLS)
const baseToolIds = allToolIds.filter(isBaseTool)
log(`init model=${CURRENT_MODEL} key=${MODEL_KEY} baseTools=${baseToolIds.length} totalFiles=${allToolIds.length} per-model-prompt=${!!SLIM_SYSTEM_PROMPT_MODEL}`)
if (SLIM_SYSTEM_PROMPT_MODEL) log(`using per-model prompt: prompt/${MODEL_KEY}.txt`)
if (allToolIds.length > baseToolIds.length) log(`${allToolIds.length - baseToolIds.length} per-model tool variants active`)

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
    Array.isArray(options?.exclude)
      ? (options.exclude as string[]).map((s) => s.toLowerCase())
      : [],
  )

  // Validate options.tools is a plain object — arrays and primitives silently fail
  const rawTools = options?.tools
  const customTools: Record<string, string> =
    rawTools && typeof rawTools === "object" && !Array.isArray(rawTools)
      ? (rawTools as Record<string, string>)
      : {}
  if (rawTools !== undefined && rawTools !== customTools) log(`warning: options.tools ignored — expected object, got ${typeof rawTools}`)

  // ── reset: wipe config dir and reseed from defaults ──
  if (options?.reset === true) {
    try {
      rmSync(CONFIG_DIR, { recursive: true, force: true })
      seedConfigDir()
      // Reload module-level vars
      SLIM_TOOLS = readToolsFromDir(CONFIG_TOOLS_DIR)
      try { SLIM_SYSTEM_PROMPT = readFileSync(CONFIG_PROMPT_FILE, "utf-8").trimEnd() } catch { SLIM_SYSTEM_PROMPT = "" }
      try { SLIM_SYSTEM_PROMPT_MODEL = readFileSync(path.join(CONFIG_PROMPT_DIR, `${MODEL_KEY}.txt`), "utf-8").trimEnd() } catch { SLIM_SYSTEM_PROMPT_MODEL = "" }
      Object.assign(STATUS, buildStatus(SLIM_TOOLS))
      writeStatus(STATUS)
      log("reset complete")
    } catch (e) {
      log(`reset failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Custom tools dir (optional — files read fresh on every session)
  const toolsDir = typeof options?.toolsDir === "string" ? resolveTilde(options.toolsDir) : CONFIG_TOOLS_DIR

  // Auto-seed custom tools dir if it doesn't exist
  if (toolsDir !== CONFIG_TOOLS_DIR && !existsSync(toolsDir)) {
    try {
      writeDirFromMap(toolsDir, DEFAULT_TOOL_DESCRIPTIONS)
    } catch { /* best-effort */ }
  }

  const fsTools = readToolsFromDir(toolsDir)

  return {
    "experimental.chat.system.transform": async (_input, output) => {
      let matched = false
      for (let i = 0; i < output.system.length; i++) {
        const text = output.system[i]
        const isDefault = DEFAULT_PROMPT_MARKERS.some((m) => text.includes(m))
        if (!isDefault) continue

        // priority: config dir per-model > config dir default > embedded default
        const prompt = SLIM_SYSTEM_PROMPT_MODEL || SLIM_SYSTEM_PROMPT

        // Preserve the environment metadata block that opencode appends after
        // the system prompt (model info, directory, date, instructions).
        // Try multiple markers in descending specificity, falling back to the
        // full original text as suffix to never drop context.
        const envBlockMarkers = [
          ENV_MARKER,
          "You are powered by",
          "\nInstructions from:",
          "\nHere is some useful information",
          "\nYou are a",
        ]
        let suffixStart = -1
        for (const m of envBlockMarkers) {
          const idx = text.indexOf(m)
          if (idx !== -1) { suffixStart = idx; break }
        }
        output.system[i] = suffixStart !== -1
          ? prompt + "\n" + text.slice(suffixStart)
          : prompt
        matched = true
      }
      if (matched) log(`prompt replaced source=${SLIM_SYSTEM_PROMPT_MODEL ? `prompt/${MODEL_KEY}.txt` : "prompt/default.txt"}`)
    },

    "tool.definition": async (input, output) => {
      if (exclude.has(input.toolID)) return
      const modelKey = `${input.toolID}.${MODEL_KEY}`
      const isPerModel = customTools[input.toolID] ? false : fsTools[modelKey] ? true : false
      const desc = customTools[input.toolID] ?? fsTools[modelKey] ?? fsTools[input.toolID] ?? SLIM_TOOLS[input.toolID]
      if (desc) {
        output.description = desc
        if (isPerModel) log(`tool=${input.toolID} per-model=${modelKey}`)
      }
    },

    // Ensure compaction summaries retain awareness of slimmed system prompt
    "experimental.session.compacting": async (_input, output) => {
      output.context.push(`Plugin active: opencode-slim-system (${baseToolIds.length} tools slimmed, custom system prompt active)`)
    },
  }
}
