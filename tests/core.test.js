import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from "node:fs"
import path from "node:path"
import os from "node:os"
import { DEFAULT_TOOL_DESCRIPTIONS, DEFAULT_SYSTEM_PROMPT } from "../src/defaults.js"
import { PLACEHOLDERS, BASE_TOOL_IDS } from "../src/constants.js"
import { parseModelFromFile } from "../src/index.js"

describe("resolvePlaceholders", () => {
  const year = new Date().getFullYear().toString()
  const plat = os.platform() === "win32" ? "windows" : os.platform() === "darwin" ? "macos" : "linux"
  const sh = path.basename(process.env.SHELL ?? "/bin/bash")

  it("resolves {{year}}", () => {
    assert.equal(PLACEHOLDERS["{{year}}"](), year)
  })

  it("resolves ${os}", () => {
    assert.equal(PLACEHOLDERS["${os}"](), plat)
  })

  it("resolves ${shell}", () => {
    assert.equal(PLACEHOLDERS["${shell}"](), sh)
  })

  it("resolves ${chaining}", () => {
    assert.equal(PLACEHOLDERS["${chaining}"](), "true")
  })

  it("resolves ${maxLines}", () => {
    assert.equal(PLACEHOLDERS["${maxLines}"](), "4000")
  })

  it("resolves ${directory}", () => {
    assert.equal(PLACEHOLDERS["${directory}"](), "session worktree")
  })
})

describe("defaults integrity", () => {
  it("has DEFAULT_SYSTEM_PROMPT with content", () => {
    assert.ok(DEFAULT_SYSTEM_PROMPT)
    assert.ok(DEFAULT_SYSTEM_PROMPT.length > 50)
    assert.ok(DEFAULT_SYSTEM_PROMPT.includes("opencode"))
  })

  it("covers all known tool IDs in DEFAULT_TOOL_DESCRIPTIONS", () => {
    for (const id of BASE_TOOL_IDS) {
      assert.ok(DEFAULT_TOOL_DESCRIPTIONS[id], `missing default entry for ${id}`)
    }
  })

  it("matches tool/*.txt files exactly", () => {
    const ROOT = path.resolve(import.meta.dirname, "..")
    const TOOL_DIR = path.join(ROOT, "tool")
    const toolFiles = new Set(
      readdirSync(TOOL_DIR).filter((f) => f.endsWith(".txt")).map((f) => f.slice(0, -4)),
    )

    const defaultIds = new Set(Object.keys(DEFAULT_TOOL_DESCRIPTIONS))

    for (const id of toolFiles) {
      assert.ok(defaultIds.has(id), `no default entry for ${id}.txt`)
      if (defaultIds.has(id)) {
        const fileContent = readFileSync(path.join(TOOL_DIR, `${id}.txt`), "utf-8").trimEnd()
        assert.equal(DEFAULT_TOOL_DESCRIPTIONS[id], fileContent)
      }
    }

    for (const id of defaultIds) {
      assert.ok(toolFiles.has(id), `missing tool/${id}.txt`)
    }
  })
})

describe("system prompt", () => {
  it("does not contain raw placeholders", () => {
    assert.ok(!DEFAULT_SYSTEM_PROMPT.includes("${"))
    assert.ok(!DEFAULT_SYSTEM_PROMPT.includes("{{"))
  })

  it("contains key behavioral instructions", () => {
    assert.match(DEFAULT_SYSTEM_PROMPT, /research/i)
    assert.match(DEFAULT_SYSTEM_PROMPT, /subagent/i)
    assert.match(DEFAULT_SYSTEM_PROMPT, /root.cause/i)
  })
})



describe("parseModelFromFile", () => {
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

  it("parses model from clean JSON", () => {
    writeFileSync(configFile, JSON.stringify({ model: "opencode/test-model" }))
    assert.equal(parseModelFromFile(configFile), "opencode/test-model")
  })

  it("parses model from jsonc with comments", () => {
    writeFileSync(configFile, [
      "{",
      '  // comment line',
      '  "model": "opencode/claude-sonnet-4",',
      "  /* block comment */",
      '  "other": "value"',
      "}",
    ].join("\n"))
    assert.equal(parseModelFromFile(configFile), "opencode/claude-sonnet-4")
  })

  it("returns unknown when no model field", () => {
    writeFileSync(configFile, JSON.stringify({ version: "1.0" }))
    assert.equal(parseModelFromFile(configFile), "unknown")
  })

  it("returns unknown for nonexistent file", () => {
    assert.equal(parseModelFromFile("/nonexistent/path"), "unknown")
  })
})

describe("tool description integrity", () => {
  it("no tool description has unbalanced backticks", () => {
    for (const [id, desc] of Object.entries(DEFAULT_TOOL_DESCRIPTIONS)) {
      const backtickCount = (desc.match(/`/g) ?? []).length
      assert.ok(backtickCount % 2 === 0, `${id} has ${backtickCount} backticks`)
    }
  })

  it("no tool description contains unresolved placeholders", () => {
    for (const [id, desc] of Object.entries(DEFAULT_TOOL_DESCRIPTIONS)) {
      const hasYear = desc.includes("{{year}}")
      const hasOs = desc.includes("${os}")
      const hasShell = desc.includes("${shell}")
      if (id !== "bash") {
        assert.ok(!(hasOs || hasShell), `${id} should not have os/shell placeholders`)
      }
    }
  })

  it("all tool descriptions are non-empty", () => {
    for (const [id, desc] of Object.entries(DEFAULT_TOOL_DESCRIPTIONS)) {
      assert.ok(desc.length > 10, `${id} description is empty`)
    }
  })
})

describe("BASE_TOOL_IDS completeness", () => {
  it("matches DEFAULT_TOOL_DESCRIPTIONS keys", () => {
    const defaultIds = new Set(Object.keys(DEFAULT_TOOL_DESCRIPTIONS))
    for (const id of BASE_TOOL_IDS) {
      assert.ok(defaultIds.has(id), `BASE_TOOL_IDS missing ${id}`)
    }
    for (const id of defaultIds) {
      assert.ok(BASE_TOOL_IDS.includes(id), `${id} missing from BASE_TOOL_IDS`)
    }
  })
})
