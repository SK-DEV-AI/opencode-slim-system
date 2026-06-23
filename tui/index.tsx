/** @jsxImportSource @opentui/solid */
import { createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import type { TuiPlugin, TuiPluginApi, TuiThemeCurrent, TuiSlotPlugin } from "@opencode-ai/plugin/tui"
import packageJson from "../package.json" with { type: "json" }
import { STATUS_FILE, CACHE_DIR } from "../src/constants.js"

const ANNOUNCED_FILE = path.join(CACHE_DIR, "announced.json")

interface StatusData {
  plugin: string
  slimmed: number
  tokensSaved: number
  latest_version: string
  update_available: boolean
  tools: string[]
}

function readStatus(): StatusData | null {
  try {
    if (!existsSync(STATUS_FILE)) return null
    const data = JSON.parse(readFileSync(STATUS_FILE, "utf-8")) as StatusData
    const fileVersion = String(data.plugin ?? "").split("@").pop()
    if (fileVersion && fileVersion !== packageJson.version) return null
    return data
  } catch {
    return null
  }
}

function loadAnnouncedVersion(): string | undefined {
  try {
    if (!existsSync(ANNOUNCED_FILE)) return undefined
    return (JSON.parse(readFileSync(ANNOUNCED_FILE, "utf-8")) as { version?: string }).version
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

async function showUpdateDialog(api: TuiPluginApi, status: StatusData) {
  const current = String(status.plugin ?? "").split("@").pop() ?? "?"
  const latest = String(status.latest_version ?? "")
  const announced = loadAnnouncedVersion()
  if (announced === latest) return

  const repoUrl = (packageJson.repository as { url?: string })?.url?.replace("git+", "").replace(".git", "") ?? "the repo"

  api.ui.dialog.replace(
    () => (
      <api.ui.DialogAlert
        title={`Slim System v${latest} available`}
        message={`Current: v${current}\nLatest:  v${latest}\n\nUpdate includes new features and fixes.\nVisit ${repoUrl}/releases for the changelog.`}
        onConfirm={() => { saveAnnouncedVersion(latest) }}
      />
    ),
    () => {
      saveAnnouncedVersion(latest)
    },
  )
}

const SlimSidebar = (props: { theme: TuiThemeCurrent }) => {
  const [status, setStatus] = createSignal<StatusData | null>(readStatus())

  onMount(() => {
    const interval = setInterval(() => {
      setStatus(readStatus())
    }, 5000)

    onCleanup(() => {
      clearInterval(interval)
    })
  })

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

      {s() && (
        <box width="100%" flexDirection="row" justifyContent="space-between">
          <text fg={props.theme.textMuted}>Tools slimmed</text>
          <text fg={props.theme.success}>{s()!.slimmed}</text>
        </box>
      )}

      {s()?.tokensSaved && (
        <box width="100%" flexDirection="row" justifyContent="space-between">
          <text fg={props.theme.textMuted}>Tokens saved/req</text>
          <text fg={props.theme.success}>~{s()!.tokensSaved}</text>
        </box>
      )}

      {s()?.update_available && (
        <box width="100%" flexDirection="row" justifyContent="space-between">
          <text fg={props.theme.warning}>Update available</text>
          <text fg={props.theme.warning}>v{s()!.latest_version}</text>
        </box>
      )}

      {!s() && (
        <text fg={props.theme.textMuted}>plugin not loaded</text>
      )}
    </box>
  )
}

function createSlimSidebarSlot(api: TuiPluginApi): TuiSlotPlugin {
  return {
    order: 899,
    slots: {
      sidebar_content: (ctx, _value) => (
        <SlimSidebar theme={ctx.theme.current} />
      ),
    },
  }
}

const tui: TuiPlugin = async (api, _options, _meta) => {
  api.slots.register(createSlimSidebarSlot(api))

  let pollCount = 0
  const MAX_POLL = 30
  const poll = setInterval(() => {
    if (++pollCount > MAX_POLL) { clearInterval(poll); return }
    const status = readStatus()
    if (!status) return
    clearInterval(poll)

    api.ui.toast({
      title: status.plugin ?? "opencode-slim-system",
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
