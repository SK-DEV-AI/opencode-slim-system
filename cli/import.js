#!/usr/bin/env node
// Import tool descriptions and system prompt from a JSON blob into the config dir.
// Usage: npx opencode-slim-import <file.json>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import os from "node:os"

const file = process.argv[2]
if (!file) {
  console.error("Usage: npx opencode-slim-import <file.json>")
  process.exit(1)
}

let data
try {
  data = JSON.parse(readFileSync(file, "utf-8"))
} catch (e) {
  console.error(`Invalid JSON in ${file}: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}
if (!data || typeof data !== "object" || Array.isArray(data)) {
  console.error("Invalid import file: expected a JSON object with optional 'tools' and 'prompt' keys")
  process.exit(1)
}

const configDir = path.join(os.homedir(), ".config", "opencode", "slim-system")
const toolsDir = path.join(configDir, "tool")
const promptDir = path.join(configDir, "prompt")

let toolCount = 0
if (data.tools && typeof data.tools === "object" && !Array.isArray(data.tools)) {
  mkdirSync(toolsDir, { recursive: true })
  for (const [id, content] of Object.entries(data.tools as Record<string, unknown>)) {
    if (typeof content !== "string") {
      console.warn(`Skipping tool "${id}": expected string content, got ${typeof content}`)
      continue
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(id)) {
      console.warn(`Skipping tool "${id}": invalid tool ID format`)
      continue
    }
    writeFileSync(path.join(toolsDir, `${id}.txt`), content + "\n")
    toolCount++
  }
}

let hasPrompt = false
if (data.prompt && typeof data.prompt === "string") {
  mkdirSync(promptDir, { recursive: true })
  writeFileSync(path.join(promptDir, "default.txt"), data.prompt + "\n")
  hasPrompt = true
}

console.log(`Imported ${toolCount} tool descriptions${hasPrompt ? " and a system prompt" : ""} to ${configDir}`)
