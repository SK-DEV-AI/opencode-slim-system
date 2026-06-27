import { DEFAULT_TOOL_DESCRIPTIONS, DEFAULT_SYSTEM_PROMPT } from "./defaults.js"
import {
  STATUS_FILE, LOG_FILE,
  CONFIG_DIR, CONFIG_TOOLS_DIR, CONFIG_PROMPT_DIR, CONFIG_PROMPT_FILE,
  PLACEHOLDERS, DEFAULT_PROMPT_MARKERS, ENV_BLOCK_MARKERS,
} from "./constants.js"
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

function log(msg) {
  try { appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`) } catch { /* best-effort */ }
}

function getPluginVersion() {
  try {
    const pkg = JSON.parse(readFileSync(
      path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "package.json"), "utf-8"))
    return pkg.version ?? "unknown"
  } catch { return "unknown" }
}

function resolvePlaceholders(text) {
  let result = text
  for (const [key, resolver] of Object.entries(PLACEHOLDERS)) {
    result = result.replaceAll(key, resolver())
  }
  return result
}

function readToolsFromDir(dir) {
  const tools = {}
  if (!existsSync(dir)) return tools
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".txt")) continue
      tools[name.slice(0, -4)] = resolvePlaceholders(readFileSync(path.join(dir, name), "utf-8").trimEnd())
    }
  } catch { /* best-effort */ }
  return tools
}

function writeDirFromMap(dir, map) {
  mkdirSync(dir, { recursive: true })
  for (const [id, content] of Object.entries(map)) {
    writeFileSync(path.join(dir, `${id}.txt`), content + "\n")
  }
}

function seedConfigDir() {
  const toolsExist = existsSync(CONFIG_TOOLS_DIR)
  const promptExist = existsSync(CONFIG_PROMPT_FILE)

  if (!toolsExist) {
    try { writeDirFromMap(CONFIG_TOOLS_DIR, DEFAULT_TOOL_DESCRIPTIONS) } catch { /* best-effort */ }
  } else {
    try {
      const existing = new Set(readdirSync(CONFIG_TOOLS_DIR).filter((f) => f.endsWith(".txt")))
      for (const id of Object.keys(DEFAULT_TOOL_DESCRIPTIONS)) {
        if (!existing.has(`${id}.txt`)) {
          writeFileSync(path.join(CONFIG_TOOLS_DIR, `${id}.txt`), DEFAULT_TOOL_DESCRIPTIONS[id] + "\n")
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

function buildStatus(tools) {
  const slimChars = Object.values(tools).reduce((sum, s) => sum + s.length, 0)
  return {
    plugin: `opencode-slim-system@${getPluginVersion()}`,
    slimmed: Object.keys(tools).length,
    tokensSaved: Math.round((STOCK_TOOL_CHARS - slimChars) / 4),
    tools: Object.keys(tools),
  }
}

function writeStatus(s) {
  try { writeFileSync(STATUS_FILE, JSON.stringify(s, null, 2)) } catch { /* best-effort */ }
}

const STOCK_TOOL_CHARS = 16395

export default async function plugin(_input, options) {
  const exclude = new Set(
    Array.isArray(options?.exclude) ? options.exclude.map((s) => s.toLowerCase()) : [],
  )

  const customTools =
    options?.tools && typeof options.tools === "object" && !Array.isArray(options.tools)
      ? options.tools
      : {}

  if (options?.tools !== undefined && options.tools !== customTools) {
    log(`warning: options.tools ignored — expected object, got ${typeof options.tools}`)
  }

  if (options?.reset === true) {
    try { rmSync(CONFIG_DIR, { recursive: true, force: true }) } catch { /* best-effort */ }
  }

  seedConfigDir()

  const homeDir = process.env.HOME ?? ""
  const toolsDir = typeof options?.toolsDir === "string"
    ? path.resolve(options.toolsDir.replace(/^~(?=$|\/)/, homeDir))
    : CONFIG_TOOLS_DIR

  if (toolsDir !== CONFIG_TOOLS_DIR && !existsSync(toolsDir)) {
    try { writeDirFromMap(toolsDir, DEFAULT_TOOL_DESCRIPTIONS) } catch { /* best-effort */ }
  }

  const fsTools = readToolsFromDir(toolsDir)
  const tools = Object.keys(fsTools).length > 0 ? fsTools : { ...DEFAULT_TOOL_DESCRIPTIONS }

  let systemPrompt
  try { systemPrompt = readFileSync(CONFIG_PROMPT_FILE, "utf-8").trimEnd() } catch { systemPrompt = "" }
  if (!systemPrompt) systemPrompt = DEFAULT_SYSTEM_PROMPT

  log(`init tools=${Object.keys(tools).length}`)

  const status = buildStatus(tools)
  writeStatus(status)

  return {
    "experimental.chat.system.transform": async (_input, output) => {
      let matched = false
      for (let i = 0; i < output.system.length; i++) {
        const text = output.system[i]
        if (!text) continue
        const isDefault = DEFAULT_PROMPT_MARKERS.some((m) => text.includes(m))
        if (!isDefault) continue
        let suffixStart = -1
        for (const m of ENV_BLOCK_MARKERS) {
          const idx = text.indexOf(m)
          if (idx !== -1) { suffixStart = idx; break }
        }
        output.system[i] = suffixStart !== -1
          ? systemPrompt + "\n" + text.slice(suffixStart)
          : systemPrompt
        matched = true
      }
      if (matched) log("prompt replaced")
    },

    "tool.definition": async (input, output) => {
      if (exclude.has(input.toolID)) return
      const desc = customTools[input.toolID] ?? tools[input.toolID]
      if (desc) output.description = desc
    },

    "experimental.session.compacting": async (_input, output) => {
      output.context.push(`Plugin active: opencode-slim-system (${Object.keys(tools).length} tools slimmed, custom system prompt active)`)
    },
  }
}

export function parseModelFromFile(configPath) {
  try {
    const raw = readFileSync(configPath, "utf-8")
    const cleaned = raw.replace(/\/\*[\s\S]*?\*\//g, "")
    const lines = cleaned.split("\n")
    for (const line of lines) {
      const noComment = line.replace(/\/\/.*$/, "")
      const match = noComment.match(/"model"\s*:\s*"([^"]+)"/)
      if (match) return match[1]
    }
    return "unknown"
  } catch { return "unknown" }
}
