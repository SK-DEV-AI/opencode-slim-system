/** @jsxImportSource @opentui/solid */
import { createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { existsSync, readFileSync } from "node:fs"
import packageJson from "../package.json" with { type: "json" }
import { STATUS_FILE } from "../src/constants.js"

function readStatus() {
  try {
    if (!existsSync(STATUS_FILE)) return null
    const data = JSON.parse(readFileSync(STATUS_FILE, "utf-8"))
    if ((data.plugin ?? "").split("@").pop() !== packageJson.version) return null
    return data
  } catch { return null }
}

const SlimSidebar = (props) => {
  const [status, setStatus] = createSignal(readStatus())
  onMount(() => {
    const interval = setInterval(() => setStatus(readStatus()), 5000)
    onCleanup(() => clearInterval(interval))
  })
  const s = createMemo(() => status())
  return (
    <box width="100%">
      <box width="100%" marginTop={1} flexDirection="row" justifyContent="space-between">
        <text fg={props.theme.text}><b>Slim System</b></text>
        {s() && <text fg={props.theme.textMuted}>v{s().plugin.split("@").pop()}</text>}
      </box>
      {s() && (
        <>
          <box width="100%" flexDirection="row" justifyContent="space-between">
            <text fg={props.theme.textMuted}>Tools slimmed</text>
            <text fg={props.theme.success}>{s().slimmed}</text>
          </box>
          <box width="100%" flexDirection="row" justifyContent="space-between">
            <text fg={props.theme.textMuted}>Tokens saved/req</text>
            <text fg={props.theme.success}>~{s().tokensSaved}</text>
          </box>
        </>
      )}
    </box>
  )
}

const tui = async (api) => {
  api.slots.register({
    order: 899,
    slots: {
      sidebar_content: (ctx) => <SlimSidebar theme={ctx.theme.current} />,
    },
  })
}

export default { id: "opencode-slim-system", tui }
