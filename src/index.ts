import type { Hooks } from "@opencode-ai/plugin"
import { DEFAULT_TOOL_DESCRIPTIONS, DEFAULT_SYSTEM_PROMPT } from "./defaults.js"
import {
  STATUS_FILE, LOG_FILE,
  CONFIG_DIR, CONFIG_TOOLS_DIR, CONFIG_PROMPT_DIR, CONFIG_PROMPT_FILE,
  PLACEHOLDERS, DEFAULT_PROMPT_MARKERS, ENV_BLOCK_MARKERS,
} from "./constants.js"
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs"
import { execSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { coerce, gt } from "semver"

function log(msg: string) {
  try { appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`) } catch { /* best-effort */ }
}

function getPluginVersion(): string {
  const candidates = [
    path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "package.json"),
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
  ]
  for (const p of candidates) {
    try {
      return (JSON.parse(readFileSync(p, "utf-8")) as { version?: string }).version ?? "unknown"
    } catch { continue }
  }
  return "unknown"
}

function getOpencodeVersion(): string {
  try {
    return execSync("opencode --version", { encoding: "utf-8", timeout: 3000 }).trim()
  } catch {
    return "unknown"
  }
}

function resolvePlaceholders(text: string): string {
  let result = text
  for (const [key, resolver] of Object.entries(PLACEHOLDERS)) {
    result = result.replaceAll(key, (resolver as () => string)())
  }
  return result
}

function modelToKey(model: string): string {
  const idx = model.lastIndexOf("/")
  return idx >= 0 ? model.slice(idx + 1) : model
}

function isModelVariant(key: string, modelKey: string): boolean {
  return key.endsWith(`.${modelKey}`)
}

function readToolsFromDir(dir: string): Record<string, string> {
  const tools: Record<string, string> = {}
  if (!existsSync(dir)) return tools
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".txt")) continue
      const toolId = name.slice(0, -4)
      tools[toolId] = resolvePlaceholders(readFileSync(path.join(dir, name), "utf-8").trimEnd())
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

function seedConfigDir() {
  const toolsExist = existsSync(CONFIG_TOOLS_DIR)
  const promptExist = existsSync(CONFIG_PROMPT_FILE)

  if (!toolsExist) {
    try {
      writeDirFromMap(CONFIG_TOOLS_DIR, DEFAULT_TOOL_DESCRIPTIONS)
    } catch { /* best-effort */ }
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

function buildStatus(tools: Record<string, string>, modelKey: string): Record<string, unknown> {
  const baseToolIds = Object.keys(tools).filter((k) => !isModelVariant(k, modelKey))
  const slimChars = baseToolIds.reduce((sum, k) => sum + ((tools[k] as string)?.length ?? 0), 0)
  return {
    model: "detected at runtime",
    model_key: modelKey,
    plugin: `opencode-slim-system@${getPluginVersion()}`,
    opencode: getOpencodeVersion(),
    slimmed: baseToolIds.length,
    tokensSaved: Math.round((STOCK_TOOL_CHARS - slimChars) / 4),
    tools: baseToolIds,
  }
}

function writeStatus(s: Record<string, unknown>) {
  try { writeFileSync(STATUS_FILE, JSON.stringify(s, null, 2)) } catch { /* best-effort */ }
}

// Stock tool description char count from opencode v1.17.9 template files.
// Measured from packages/opencode/src/tool/*.txt in the opencode repo.
// This is approximate — rendered descriptions are slightly longer due to
// variable substitution (especially bash/shell which adds ~900 chars).
// Update this value when the plugin is re-baselined against a newer opencode.
const STOCK_TOOL_CHARS = 16395

export default async function plugin(
  _input: import("@opencode-ai/plugin").PluginInput,
  options?: import("@opencode-ai/plugin").PluginOptions,
): Promise<Hooks> {
  const exclude = new Set<string>(
    Array.isArray(options?.exclude)
      ? (options.exclude as string[]).map((s) => s.toLowerCase())
      : [],
  )

  const rawTools = options?.tools
  const customTools: Record<string, string> =
    rawTools && typeof rawTools === "object" && !Array.isArray(rawTools)
      ? (rawTools as Record<string, string>)
      : {}
  if (rawTools !== undefined && rawTools !== customTools) log(`warning: options.tools ignored — expected object, got ${typeof rawTools}`)

  if (options?.reset === true) {
    try {
      rmSync(CONFIG_DIR, { recursive: true, force: true })
    } catch { /* best-effort */ }
  }

  seedConfigDir()

  const homeDir = process.env.HOME ?? ""
  const toolsDir = typeof options?.toolsDir === "string" ? path.resolve(options.toolsDir.replace(/^~(?=$|\/)/, homeDir)) : CONFIG_TOOLS_DIR

  if (toolsDir !== CONFIG_TOOLS_DIR && !existsSync(toolsDir)) {
    try {
      writeDirFromMap(toolsDir, DEFAULT_TOOL_DESCRIPTIONS)
    } catch { /* best-effort */ }
  }

  const fsTools = readToolsFromDir(toolsDir)
  const tools: Record<string, string> = Object.keys(fsTools).length > 0
    ? fsTools
    : { ...DEFAULT_TOOL_DESCRIPTIONS }

  let systemPrompt: string
  try { systemPrompt = readFileSync(CONFIG_PROMPT_FILE, "utf-8").trimEnd() } catch { systemPrompt = "" }
  if (!systemPrompt) {
    systemPrompt = DEFAULT_SYSTEM_PROMPT
  }

  const modelRaw = getCurrentModel()
  const modelKey = modelToKey(modelRaw)

  let perModelPrompt = ""
  try { perModelPrompt = readFileSync(path.join(CONFIG_PROMPT_DIR, `${modelKey}.txt`), "utf-8").trimEnd() } catch { /* best-effort */ }

  const allToolIds = Object.keys(tools)
  const baseToolIds = allToolIds.filter((k) => !isModelVariant(k, modelKey))

  const status = buildStatus(tools, modelKey)
  writeStatus(status)

  log(`init model=${modelRaw} key=${modelKey} baseTools=${baseToolIds.length} totalFiles=${allToolIds.length} per-model-prompt=${!!perModelPrompt}`)
  if (perModelPrompt) log(`using per-model prompt: prompt/${modelKey}.txt`)
  if (allToolIds.length > baseToolIds.length) log(`${allToolIds.length - baseToolIds.length} per-model tool variants active`)

  const pluginVersion = getPluginVersion()
  checkLatestVersion().then((latest) => {
    if (latest) {
      const coercedLatest = coerce(latest)
      const coercedCurrent = coerce(pluginVersion)
      if (coercedLatest && coercedCurrent && gt(coercedLatest, coercedCurrent)) {
        status.latest_version = latest
        status.update_available = true
      } else {
        status.latest_version = latest
      }
    } else {
      status.latest_version = pluginVersion
    }
    writeStatus(status)
  })

  return {
    "experimental.chat.system.transform": async (_input, output) => {
      let matched = false
      for (let i = 0; i < output.system.length; i++) {
        const text = output.system[i] as string | undefined
        if (!text) continue
        const isDefault = DEFAULT_PROMPT_MARKERS.some((m) => text.includes(m))
        if (!isDefault) continue

        const promptSource = perModelPrompt || systemPrompt

        let suffixStart = -1
        for (const m of ENV_BLOCK_MARKERS) {
          const idx = text.indexOf(m)
          if (idx !== -1) { suffixStart = idx; break }
        }
        output.system[i] = suffixStart !== -1
          ? promptSource + "\n" + text.slice(suffixStart)
          : promptSource
        matched = true
      }
      if (matched) log(`prompt replaced source=${perModelPrompt ? `prompt/${modelKey}.txt` : "prompt/default.txt"}`)
    },

    "tool.definition": async (input, output) => {
      if (exclude.has(input.toolID)) return
      const variantKey = `${input.toolID}.${modelKey}`
      const isPerModel = customTools[input.toolID] ? false : tools[variantKey] ? true : false
      const desc = customTools[input.toolID] ?? tools[variantKey] ?? tools[input.toolID]
      if (desc) {
        output.description = desc
        if (isPerModel) log(`tool=${input.toolID} per-model=${variantKey}`)
      }
    },

    "experimental.session.compacting": async (_input, output) => {
      output.context.push(`Plugin active: opencode-slim-system (${baseToolIds.length} tools slimmed, custom system prompt active)`)
    },
  }
}

export function parseModelFromFile(configPath: string): string {
  try {
    const raw = readFileSync(configPath, "utf-8")
    const cleaned = raw.replace(/\/\*[\s\S]*?\*\//g, "")
    const lines = cleaned.split("\n")
    for (const line of lines) {
      const noComment = line.replace(/\/\/.*$/, "")
      const match = noComment.match(/"model"\s*:\s*"([^"]+)"/)
      if (match) return match[1] ?? "unknown"
    }
    return "unknown"
  } catch {
    return "unknown"
  }
}

function getCurrentModel(): string {
  return parseModelFromFile(path.join(process.env.HOME ?? "", ".config", "opencode", "opencode.jsonc"))
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
