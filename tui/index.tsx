/** @jsxImportSource @opentui/solid */
// @ts-nocheck
import { createMemo, createSignal, onCleanup } from "solid-js"
import { existsSync, readFileSync } from "node:fs"
import type { TuiPlugin, TuiPluginApi, TuiThemeCurrent, TuiSlotPlugin } from "@opencode-ai/plugin/tui"
import packageJson from "../package.json"

const STATUS_FILE = "/tmp/opencode-slim-system.json"

function readStatus() {
  try {
    if (!existsSync(STATUS_FILE)) return null
    return JSON.parse(readFileSync(STATUS_FILE, "utf-8"))
  } catch {
    return null
  }
}

const SlimSidebar = (props: { theme: TuiThemeCurrent }) => {
  const [status, setStatus] = createSignal(readStatus())

  // Poll every 5s (same as MC's RPC poller)
  onCleanup(
    setInterval(() => {
      setStatus(readStatus())
    }, 5000),
  )

  const s = createMemo(() => status())

  return (
    <box width="100%">
      <box width="100%" marginTop={1} flexDirection="row" justifyContent="space-between">
        <text fg={props.theme.text}>
          <b>Slim System</b>
        </text>
        {s() ? (
          <text fg={props.theme.textMuted}>v{s()!.plugin.split("@").pop()}</text>
        ) : null}
      </box>

      {/* Stat line: how many tools slimmed */}
      {s() && (
        <box width="100%" flexDirection="row" justifyContent="space-between">
          <text fg={props.theme.textMuted}>Tools slimmed</text>
          <text fg={props.theme.success}>{s()!.slimmed}</text>
        </box>
      )}

      {/* Missing tools — only shown when non-empty */}
      {(s()?.missing?.length ?? 0) > 0 && (
        <box width="100%" flexDirection="row" justifyContent="space-between">
          <text fg={props.theme.warning}>
            ⚠ Tools missing
          </text>
          <text fg={props.theme.warning}>
            {s()!.missing.length}
          </text>
        </box>
      )}

      {/* Not loaded indicator */}
      {!s() && (
        <text fg={props.theme.textMuted}>plugin not loaded</text>
      )}
    </box>
  )
}

function createSlimSidebarSlot(api: TuiPluginApi): TuiSlotPlugin {
  return {
    order: 899, // below MC sidebar (150), above bottom
    slots: {
      sidebar_content: (ctx, _value) => (
        <SlimSidebar theme={ctx.theme.current} />
      ),
    },
  }
}

const tui: TuiPlugin = async (api, _options, _meta) => {
  // Register sidebar slot
  api.slots.register(createSlimSidebarSlot(api))

  // Show startup toast
  const status = readStatus()
  if (status) {
    const missing = status.missing?.length ?? 0
    const suffix = missing > 0 ? `, ⚠ ${missing} missing` : ""
    api.ui.toast({
      title: status.plugin ?? "opencode-slim-system",
      message: `${status.slimmed} tool descriptions slimmed` + suffix,
      variant: missing > 0 ? "warning" : "success",
      duration: 4000,
    })
  }
}

export default {
  id: "opencode-slim-system",
  tui,
}
