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

const data = JSON.parse(readFileSync(file, "utf-8"))
if (!data || typeof data !== "object") {
  console.error("Invalid import file: expected a JSON object")
  process.exit(1)
}

const configDir = path.join(os.homedir(), ".config", "opencode", "slim-system")
const toolsDir = path.join(configDir, "tool")
const promptDir = path.join(configDir, "prompt")

if (data.tools && typeof data.tools === "object") {
  mkdirSync(toolsDir, { recursive: true })
  for (const [id, content] of Object.entries(data.tools as Record<string, string>)) {
    writeFileSync(path.join(toolsDir, `${id}.txt`), (content ?? "") + "\n")
  }
}

if (data.prompt && typeof data.prompt === "string") {
  mkdirSync(promptDir, { recursive: true })
  writeFileSync(path.join(promptDir, "default.txt"), data.prompt + "\n")
}

console.log(`Imported ${data.tools ? Object.keys(data.tools).length : 0} tool descriptions and ${data.prompt ? "a" : "no"} system prompt to ${configDir}`)
