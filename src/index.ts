import type { Hooks } from "@opencode-ai/plugin"
import { readSlimSystemPrompt, readSlimToolDescriptions } from "./read-content"

const SLIM_SYSTEM_PROMPT = readSlimSystemPrompt()
const SLIM_TOOLS = readSlimToolDescriptions()

const ENV_MARKER = "You are powered by the model named"
const DEFAULT_PROMPT_MARKERS = [
  "best coding agent on the planet",
  "opencode, an interactive CLI tool",
  "opencode, an agent",
  "expert AI programming assistant",
  "interactive general AI agent",
]

export default async function plugin(): Promise<Hooks> {
  return {
    "experimental.chat.system.transform": async (_input, output) => {
      for (let i = 0; i < output.system.length; i++) {
        const text = output.system[i]
        const isDefault = DEFAULT_PROMPT_MARKERS.some((m) => text.includes(m))
        if (!isDefault) continue

        const envIdx = text.indexOf(ENV_MARKER)
        if (envIdx !== -1) {
          output.system[i] = SLIM_SYSTEM_PROMPT + "\n" + text.slice(envIdx)
        } else {
          output.system[i] = SLIM_SYSTEM_PROMPT
        }
      }
    },

    "tool.definition": async (input, output) => {
      const slim = SLIM_TOOLS[input.toolID]
      if (slim) {
        output.description = slim
      }
    },
  }
}
