#!/usr/bin/env node
import { readdirSync, existsSync } from "node:fs"
import { execSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const TOOL_DIR = path.join(ROOT, "tool")
const showDiff = process.argv.includes("--diff")

const KNOWN_TOOL_IDS = [
  "apply_patch", "bash", "edit", "glob", "grep", "lsp",
  "plan_enter", "plan_exit", "question", "read",
  "skill", "task", "todowrite", "webfetch", "websearch", "write",
]

const localFiles = new Set()
if (existsSync(TOOL_DIR)) {
  for (const f of readdirSync(TOOL_DIR)) {
    if (f.endsWith(".txt")) localFiles.add(f.slice(0, -4))
  }
}

const knownSet = new Set(KNOWN_TOOL_IDS)
const missing = []
const extra = []

for (const id of knownSet) {
  if (!localFiles.has(id)) missing.push(id)
}
for (const id of localFiles) {
  if (!knownSet.has(id)) extra.push(id)
}

let opencodeVer = "unknown"
try {
  opencodeVer = execSync("opencode --version", { encoding: "utf-8", timeout: 3000 }).trim()
} catch { /* not installed */ }

console.log(`opencode: ${opencodeVer} | slim-system files: ${localFiles.size}`)

if (missing.length === 0 && extra.length === 0) {
  console.log(`OK All ${localFiles.size} tool descriptions match opencode built-in tools`)
  process.exit(0)
}

if (missing.length > 0) {
  console.log(`MISSING (add tool/*.txt): ${missing.join(", ")}`)
}
if (extra.length > 0) {
  console.log(`EXTRA (remove tool/*.txt): ${extra.join(", ")}`)
}

if (showDiff) {
  if (missing.length > 0) {
    console.log("---")
    console.log("Create missing tool files:")
    for (const id of missing) {
      console.log(`  echo "<slim description>" > "${path.join(TOOL_DIR, `${id}.txt`)}"`)
    }
  }
  if (extra.length > 0) {
    console.log("Remove extra files:")
    for (const id of extra) {
      console.log(`  rm "${path.join(TOOL_DIR, `${id}.txt`)}"`)
    }
  }
  console.log("Then: cd ROOT && node scripts/gen-defaults.js && git add -A && git commit")
}

process.exit(1)
