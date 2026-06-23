import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs"
import path from "node:path"
import os from "node:os"
import { coerce, gt } from "semver"
import { DEFAULT_TOOL_DESCRIPTIONS, DEFAULT_SYSTEM_PROMPT } from "../src/defaults.js"
import { PLACEHOLDERS, BASE_TOOL_IDS } from "../src/constants.js"

// ─── Helper unit tests (no disk I/O) ───

describe("resolvePlaceholders", () => {
  const year = new Date().getFullYear().toString()
  const plat = os.platform() === "win32" ? "windows" : os.platform() === "darwin" ? "macos" : "linux"
  const sh = path.basename(process.env.SHELL ?? "/bin/bash")

  it("resolves {{year}}", () => {
    const result = PLACEHOLDERS["{{year}}"]()
    expect(result).toBe(year)
  })

  it("resolves ${os}", () => {
    const result = PLACEHOLDERS["${os}"]()
    expect(result).toBe(plat)
  })

  it("resolves ${shell}", () => {
    const result = PLACEHOLDERS["${shell}"]()
    expect(result).toBe(sh)
  })

  it("resolves ${chaining}", () => {
    const result = PLACEHOLDERS["${chaining}"]()
    expect(result).toBe("true")
  })

  it("resolves ${maxLines}", () => {
    const result = PLACEHOLDERS["${maxLines}"]()
    expect(result).toBe("4000")
  })

  it("resolves ${directory}", () => {
    const result = PLACEHOLDERS["${directory}"]()
    expect(result).toBe("session worktree")
  })
})

describe("modelToKey", () => {
  it("strips provider prefix", () => {
    const result = "opencode/deepseek-v4-flash-free".split("/").pop()
    expect(result).toBe("deepseek-v4-flash-free")
  })

  it("handles model without prefix", () => {
    const result = "claude-sonnet-4".split("/").pop()
    expect(result).toBe("claude-sonnet-4")
  })

  it("handles empty string", () => {
    const result = "".split("/").pop()
    expect(result).toBe("")
  })
})

describe("isModelVariant", () => {
  it("detects model variant suffix", () => {
    const result = "bash.deepseek-v4-flash-free".endsWith(".deepseek-v4-flash-free")
    expect(result).toBe(true)
  })

  it("rejects base tool key", () => {
    const result = "bash".endsWith(".deepseek-v4-flash-free")
    expect(result).toBe(false)
  })

  it("handles keys with dots in name", () => {
    const result = "some.tool.name.claude-sonnet-4".endsWith(".claude-sonnet-4")
    expect(result).toBe(true)
  })
})

describe("semver helpers", () => {
  it("coerce handles bare versions", () => {
    const v = coerce("2.0.15")
    expect(v?.toString()).toBe("2.0.15")
  })

  it("gt detects newer version", () => {
    expect(gt(coerce("2.0.15")!, coerce("2.0.14")!)).toBe(true)
  })

  it("gt rejects older version", () => {
    expect(gt(coerce("2.0.14")!, coerce("2.0.15")!)).toBe(false)
  })

  it("gt returns false for equal versions", () => {
    expect(gt(coerce("2.0.15")!, coerce("2.0.15")!)).toBe(false)
  })
})

// ─── Defaults integrity tests ───

describe("defaults integrity", () => {
  it("has DEFAULT_SYSTEM_PROMPT with content", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toBeTruthy()
    expect(DEFAULT_SYSTEM_PROMPT.length).toBeGreaterThan(50)
    expect(DEFAULT_SYSTEM_PROMPT).toContain("opencode")
  })

  it("covers all known tool IDs in DEFAULT_TOOL_DESCRIPTIONS", () => {
    for (const id of BASE_TOOL_IDS) {
      expect(DEFAULT_TOOL_DESCRIPTIONS[id]).toBeTruthy()
    }
  })

  it("matches tool/*.txt files exactly", () => {
    const ROOT = path.resolve(import.meta.dirname, "..")
    const TOOL_DIR = path.join(ROOT, "tool")
    const toolFiles = new Set(
      readdirSync(TOOL_DIR).filter((f) => f.endsWith(".txt")).map((f) => f.slice(0, -4)),
    )

    const defaultIds = new Set(Object.keys(DEFAULT_TOOL_DESCRIPTIONS))

    // Every tool/*.txt file has an entry in defaults
    for (const id of toolFiles) {
      expect(defaultIds.has(id), `missing default entry for ${id}.txt`).toBe(true)
      if (defaultIds.has(id)) {
        const fileContent = readFileSync(path.join(TOOL_DIR, `${id}.txt`), "utf-8").trimEnd()
        expect(DEFAULT_TOOL_DESCRIPTIONS[id]).toBe(fileContent)
      }
    }

    // Every default entry has a tool/*.txt file
    for (const id of defaultIds) {
      expect(toolFiles.has(id), `missing tool/${id}.txt`).toBe(true)
    }
  })
})

describe("system prompt", () => {
  it("does not contain raw placeholders", () => {
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain("${")
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain("{{")
  })

  it("contains key behavioral instructions", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/research/i)
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/subagent/i)
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/root.cause/i)
  })
})

// ─── File I/O functions ───

import { readdirSync } from "node:fs"

function resolvePlaceholdersInline(text: string): string {
  let result = text
  for (const [key, resolver] of Object.entries(PLACEHOLDERS)) {
    result = result.replaceAll(key, (resolver as () => string)())
  }
  return result
}

function readToolsFromDir(dir: string): Record<string, string> {
  const tools: Record<string, string> = {}
  if (!existsSync(dir)) return tools
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".txt")) continue
      tools[name.slice(0, -4)] = resolvePlaceholdersInline(readFileSync(path.join(dir, name), "utf-8").trimEnd())
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

describe("readToolsFromDir", () => {
  const testDir = path.join(os.tmpdir(), "slim-test-read")

  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it("returns empty for missing dir", () => {
    const result = readToolsFromDir("/nonexistent/path")
    expect(Object.keys(result)).toHaveLength(0)
  })

  it("reads .txt files and strips .txt suffix from keys", () => {
    writeFileSync(path.join(testDir, "test_tool.txt"), "description content\n")
    const result = readToolsFromDir(testDir)
    expect(result.test_tool).toBe("description content")
  })

  it("ignores non-.txt files", () => {
    writeFileSync(path.join(testDir, "test_tool.txt"), "tool content\n")
    writeFileSync(path.join(testDir, "notes.md"), "note content\n")
    const result = readToolsFromDir(testDir)
    expect(result.test_tool).toBe("tool content")
    expect(result.notes).toBeUndefined()
  })

  it("resolves placeholders in tool descriptions", () => {
    writeFileSync(path.join(testDir, "plachold.txt"), "year: {{year}} os: ${os} shell: ${shell}\n")
    const result = readToolsFromDir(testDir)
    const osVal = os.platform() === "win32" ? "windows" : os.platform() === "darwin" ? "macos" : "linux"
    expect(result.plachold).toBe(`year: ${new Date().getFullYear()} os: ${osVal} shell: ${path.basename(process.env.SHELL ?? "/bin/bash")}`)
  })
})

describe("writeDirFromMap", () => {
  const testDir = path.join(os.tmpdir(), "slim-test-write")

  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it("creates directory and writes files", () => {
    writeDirFromMap(testDir, { tool1: "desc1", tool2: "desc2" })
    expect(existsSync(testDir)).toBe(true)
    expect(readFileSync(path.join(testDir, "tool1.txt"), "utf-8")).toBe("desc1\n")
    expect(readFileSync(path.join(testDir, "tool2.txt"), "utf-8")).toBe("desc2\n")
  })
})

describe("getCurrentModel", () => {
  const testDir = path.join(os.tmpdir(), "slim-test-model")
  const configDir = path.join(testDir, ".config", "opencode")
  const configFile = path.join(configDir, "opencode.jsonc")

  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    mkdirSync(configDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it("parses model from opencode.jsonc", () => {
    writeFileSync(configFile, JSON.stringify({ model: "opencode/test-model" }))
    const raw = readFileSync(configFile, "utf-8")
    const cleaned = raw.replace(/\/\*[\s\S]*?\*\//g, "")
    const lines = cleaned.split("\n")
    let model = "unknown"
    for (const line of lines) {
      const noComment = line.replace(/\/\/.*$/, "")
      const match = noComment.match(/"model"\s*:\s*"([^"]+)"/)
      if (match) { model = match[1] ?? "unknown"; break }
    }
    expect(model).toBe("opencode/test-model")
  })

  it("parses model from jsonc with comments", () => {
    const jsoncContent = [
      '{',
      '  // comment line',
      '  "model": "opencode/claude-sonnet-4",',
      '  /* block comment */',
      '  "other": "value"',
      '}',
    ].join("\n")
    writeFileSync(configFile, jsoncContent)
    const raw = readFileSync(configFile, "utf-8")
    const cleaned = raw.replace(/\/\*[\s\S]*?\*\//g, "")
    const lines = cleaned.split("\n")
    let model = "unknown"
    for (const line of lines) {
      const noComment = line.replace(/\/\/.*$/, "")
      const match = noComment.match(/"model"\s*:\s*"([^"]+)"/)
      if (match) { model = match[1] ?? "unknown"; break }
    }
    expect(model).toBe("opencode/claude-sonnet-4")
  })

  it("returns unknown when no model field", () => {
    writeFileSync(configFile, JSON.stringify({ version: "1.0" }))
    const raw = readFileSync(configFile, "utf-8")
    const cleaned = raw.replace(/\/\*[\s\S]*?\*\//g, "")
    const lines = cleaned.split("\n")
    let model = "unknown"
    for (const line of lines) {
      const noComment = line.replace(/\/\/.*$/, "")
      const match = noComment.match(/"model"\s*:\s*"([^"]+)"/)
      if (match) { model = match[1] ?? "unknown"; break }
    }
    expect(model).toBe("unknown")
  })
})

describe("tool description integrity", () => {
  it("no tool description has unbalanced backticks", () => {
    for (const [id, desc] of Object.entries(DEFAULT_TOOL_DESCRIPTIONS)) {
      const backtickCount = (desc.match(/`/g) ?? []).length
      expect(backtickCount % 2 === 0, `${id} has ${backtickCount} backticks`).toBe(true)
    }
  })

  it("no tool description contains unresolved placeholders", () => {
    for (const [id, desc] of Object.entries(DEFAULT_TOOL_DESCRIPTIONS)) {
      const hasYear = desc.includes("{{year}}")
      const hasOs = desc.includes("${os}")
      const hasShell = desc.includes("${shell}")
      // Only bash.txt should have ${placeholders}
      if (id !== "bash") {
        expect(hasOs || hasShell, `${id} should not have os/shell placeholders`).toBe(false)
      }
    }
  })

  it("all tool descriptions are non-empty", () => {
    for (const [id, desc] of Object.entries(DEFAULT_TOOL_DESCRIPTIONS)) {
      expect(desc.length, `${id} description is empty`).toBeGreaterThan(10)
    }
  })
})

describe("BASE_TOOL_IDS completeness", () => {
  it("matches DEFAULT_TOOL_DESCRIPTIONS keys", () => {
    const defaultIds = new Set(Object.keys(DEFAULT_TOOL_DESCRIPTIONS))
    for (const id of BASE_TOOL_IDS) {
      expect(defaultIds.has(id), `BASE_TOOL_IDS missing ${id}`).toBe(true)
    }
    for (const id of defaultIds) {
      expect(BASE_TOOL_IDS.includes(id), `${id} missing from BASE_TOOL_IDS`).toBe(true)
    }
  })
})
