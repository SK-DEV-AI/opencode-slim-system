/** @jsxImportSource @opentui/solid */
import { createSignal, onCleanup, onMount } from "solid-js"
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

const StatRow = (props) => (
  <box width="100%" flexDirection="row" justifyContent="space-between">
    <text fg={props.theme.textMuted}>{props.label}</text>
    <text fg={props.fg ?? props.theme.success}><b>{props.value}</b></text>
  </box>
)

const SlimSidebar = (props) => {
  const [status, setStatus] = createSignal(readStatus())

  onMount(() => {
    // Retry up to 5× at 1s for the server plugin to seed the status file
    if (status()) return
    let tries = 0
    const interval = setInterval(() => {
      setStatus(readStatus())
      if (++tries >= 5 || status()) clearInterval(interval)
    }, 1000)
    onCleanup(() => clearInterval(interval))
  })

  const s = () => status()
  return (
    <box width="100%" flexDirection="column" border={{ type: "single" }} borderColor={props.theme.borderActive} paddingLeft={1} paddingRight={1}>
      {/* Header */}
      <box width="100%" flexDirection="row" justifyContent="space-between">
        <text fg={props.theme.text}><b>Slim System</b></text>
        {s() && <text fg={props.theme.accent}>v{s().plugin.split("@").pop()}</text>}
      </box>

      {/* Stats */}
      {s() ? (
        <>
          <StatRow theme={props.theme} label="Tools slimmed" value={s().slimmed} />
          <StatRow theme={props.theme} label="Tokens saved/req" value={`~${s().tokensSaved}`} />
        </>
      ) : (
        <text fg={props.theme.textMuted}>loading…</text>
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
