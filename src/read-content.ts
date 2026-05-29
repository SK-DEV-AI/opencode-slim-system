import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

export function readSlimSystemPrompt(): string {
  return readFileSync(path.join(root, "prompt", "default.txt"), "utf-8").trimEnd()
}

export function readSlimToolDescriptions(): Record<string, string> {
  const dir = path.join(root, "tool")
  const out: Record<string, string> = {}
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".txt")) continue
    const id = name.slice(0, -4)
    out[id] = readFileSync(path.join(dir, name), "utf-8").trimEnd()
  }
  return out
}
