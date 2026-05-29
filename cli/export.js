#!/usr/bin/env node
// Export tool descriptions and system prompt from config dir as a single JSON blob.
// Usage: npx opencode-slim-export [--config-dir <path>]
import { readFileSync, readdirSync, existsSync } from "node:fs"
import path from "node:path"
import os from "node:os"

const configDir = path.join(os.homedir(), ".config", "opencode", "slim-system")
const toolsDir = path.join(configDir, "tool")
const promptFile = path.join(configDir, "prompt", "default.txt")

const out: Record<string, unknown> = { version: 2 }

if (existsSync(promptFile)) {
  out.prompt = readFileSync(promptFile, "utf-8").trimEnd()
}
if (existsSync(toolsDir)) {
  out.tools = {}
  for (const name of readdirSync(toolsDir)) {
    if (!name.endsWith(".txt")) continue
    out.tools[name.slice(0, -4)] = readFileSync(path.join(toolsDir, name), "utf-8").trimEnd()
  }
}

process.stdout.write(JSON.stringify(out, null, 2) + "\n")
