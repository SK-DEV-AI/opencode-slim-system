/** @jsxImportSource @opentui/solid */
// @ts-nocheck
import { createMemo, createSignal, onCleanup } from "solid-js"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import os from "node:os"
import type { TuiPlugin, TuiPluginApi, TuiThemeCurrent, TuiSlotPlugin } from "@opencode-ai/plugin/tui"
import packageJson from "../package.json"

const STATUS_FILE = "/tmp/opencode-slim-system.json"
const ANNOUNCED_FILE = path.join(os.homedir(), ".local", "state", "opencode-slim-system", "announced.json")

function readStatus() {
  try {
    if (!existsSync(STATUS_FILE)) return null
    const data = JSON.parse(readFileSync(STATUS_FILE, "utf-8"))
    // If the status file is from a different version, it's stale — ignore it.
    // The server plugin writes a fresh one when a session starts.
    const fileVersion = String((data.plugin as string) ?? "").split("@").pop()
    if (fileVersion && fileVersion !== packageJson.version) return null
    return data
  } catch {
    return null
  }
}

function loadAnnouncedVersion() {
  try {
    if (!existsSync(ANNOUNCED_FILE)) return undefined
    return JSON.parse(readFileSync(ANNOUNCED_FILE, "utf-8")).version
  } catch {
    return undefined
  }
}

function saveAnnouncedVersion(version: string) {
  try {
    mkdirSync(path.dirname(ANNOUNCED_FILE), { recursive: true })
    writeFileSync(ANNOUNCED_FILE, JSON.stringify({ version }))
  } catch { /* best-effort */ }
}

async function showUpdateDialog(api: TuiPluginApi, status: Record<string, unknown>) {
  const current = String(status.plugin ?? "").split("@").pop() ?? "?"
  const latest = String(status.latest_version ?? "")
  const announced = loadAnnouncedVersion()

  // Already announced this version — skip
  if (announced === latest) return

  const title = `Slim System v${latest} available`
  const message = [
    `Current: v${current}`,
    `Latest:  v${latest}`,
    "",
    "Update includes new features and fixes.",
    "Visit github.com/SK-DEV-AI/opencode-slim-system/releases",
    "for the changelog.",
  ].join("\n")

  api.ui.dialog.replace(
    () => (
      <api.ui.DialogAlert
        title={title}
        message={message}
        onConfirm={() => { saveAnnouncedVersion(latest) }}
      />
    ),
    () => {
      // Dismissed via Escape — still mark so it doesn't re-prompt
      saveAnnouncedVersion(latest)
    },
  )
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
        <box flexDirection="row">
          {s()?.update_available && (
            <text fg={props.theme.warning}>⬆ </text>
          )}
          {s() ? (
            <text fg={props.theme.textMuted}>v{s()!.plugin.split("@").pop()}</text>
          ) : null}
        </box>
      </box>

      {/* Stat line: how many tools slimmed */}
      {s() && (
        <box width="100%" flexDirection="row" justifyContent="space-between">
          <text fg={props.theme.textMuted}>Tools slimmed</text>
          <text fg={props.theme.success}>{s()!.slimmed}</text>
        </box>
      )}

      {/* Update available indicator */}
      {s()?.update_available && (
        <box width="100%" flexDirection="row" justifyContent="space-between">
          <text fg={props.theme.warning}>Update available</text>
          <text fg={props.theme.warning}>v{s()!.latest_version}</text>
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

  // Listen for the server plugin to write a fresh status file, then toast once.
  // The server and TUI load in separate processes so we can't rely on ordering.
  const poll = setInterval(() => {
    const status = readStatus()
    if (!status) return
    clearInterval(poll)

    api.ui.toast({
      title: status.plugin ?? "opcode-slim-system",
      message: `${status.slimmed} tool descriptions slimmed`,
      variant: "success",
      duration: 4000,
    })

    if (status.update_available && status.latest_version) {
      setTimeout(() => {
        void showUpdateDialog(api, status)
      }, 1500)
    }
  }, 1000)
}

export default {
  id: "opencode-slim-system",
  tui,
}
