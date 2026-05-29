#!/usr/bin/env node
// Dump embedded default tool descriptions and system prompt as JSON.
// Useful for stateless injection into AGENTS.md or reproducing a clean config.
// Usage: npx opencode-slim-dump [--config-dir]
import { readFileSync, readdirSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const out: Record<string, unknown> = {
  $schema: "https://raw.githubusercontent.com/SK-DEV-AI/opencode-slim-system/refs/heads/master/schema.json",
  version: 2,
}

const useConfigDir = process.argv.includes("--config-dir")
const toolsDir = useConfigDir
  ? path.join(os.homedir(), ".config", "opencode", "slim-system", "tool")
  : path.join(PLUGIN_ROOT, "tool")
const promptFile = useConfigDir
  ? path.join(os.homedir(), ".config", "opencode", "slim-system", "prompt", "default.txt")
  : path.join(PLUGIN_ROOT, "prompt", "default.txt")

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
