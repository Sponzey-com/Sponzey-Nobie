import { execFile, spawn } from "node:child_process"
import { promisify } from "node:util"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import type { AgentTool, ToolResult } from "../types.js"
import { canYeonjangHandleMethod, invokeYeonjangMethod, isYeonjangUnavailableError } from "../../yeonjang/mqtt-client.js"

const execFileAsync = promisify(execFile)

// ─── Types ────────────────────────────────────────────────────────────────────

interface AppLaunchParams {
  app: string
  args?: string[]
  background?: boolean
}

interface AppListParams {
  filter?: string
}

interface AppInfo {
  name: string
  path: string
}

interface YeonjangApplicationLaunchResult {
  launched: boolean
  application: string
  pid?: number
  message: string
}

// ─── App discovery ────────────────────────────────────────────────────────────

async function listAppsMac(filter?: string): Promise<AppInfo[]> {
  const dirs = ["/Applications", join(homedir(), "Applications")]
  const apps: AppInfo[] = []

  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    try {
      for (const entry of readdirSync(dir)) {
        if (!entry.endsWith(".app")) continue
        const name = entry.replace(/\.app$/, "")
        if (filter && !name.toLowerCase().includes(filter.toLowerCase())) continue
        apps.push({ name, path: join(dir, entry) })
      }
    } catch { /* skip unreadable dirs */ }
  }

  // Also search with mdfind for apps outside standard directories
  if (apps.length < 5) {
    try {
      const query = filter ? `kMDItemKind == "Application" && kMDItemDisplayName == "*${filter}*"cd` : `kMDItemKind == "Application"`
      const { stdout } = await execFileAsync("mdfind", ["-onlyin", "/Applications", query])
      for (const path of stdout.split("\n").filter(Boolean)) {
        const name = path.split("/").at(-1)?.replace(/\.app$/, "") ?? ""
        if (!apps.some((a) => a.path === path)) {
          apps.push({ name, path })
        }
      }
    } catch { /* mdfind may not be available */ }
  }

  return apps.sort((a, b) => a.name.localeCompare(b.name))
}

async function listAppsLinux(filter?: string): Promise<AppInfo[]> {
  const desktopDir = "/usr/share/applications"
  const apps: AppInfo[] = []
  if (!existsSync(desktopDir)) return apps

  for (const entry of readdirSync(desktopDir)) {
    if (!entry.endsWith(".desktop")) continue
    const name = entry.replace(/\.desktop$/, "")
    if (filter && !name.toLowerCase().includes(filter.toLowerCase())) continue
    apps.push({ name, path: join(desktopDir, entry) })
  }
  return apps.sort((a, b) => a.name.localeCompare(b.name))
}

async function listApps(filter?: string): Promise<AppInfo[]> {
  switch (process.platform) {
    case "darwin": return listAppsMac(filter)
    case "linux": return listAppsLinux(filter)
    default: return []
  }
}

// ─── App launch ───────────────────────────────────────────────────────────────

async function launchApp(app: string, args: string[], background: boolean): Promise<void> {
  const isPath = app.startsWith("/") || app.startsWith("./") || app.startsWith("~")

  if (process.platform === "darwin") {
    const openArgs = isPath ? [app, ...args] : ["-a", app, ...(args.length > 0 ? ["--args", ...args] : [])]
    if (background) {
      spawn("open", openArgs, { detached: true, stdio: "ignore" }).unref()
    } else {
      await execFileAsync("open", openArgs)
    }
    return
  }

  if (process.platform === "linux") {
    const cmd = isPath ? app : app
    if (background) {
      spawn(cmd, args, { detached: true, stdio: "ignore" }).unref()
    } else {
      await execFileAsync(cmd, args)
    }
    return
  }

  throw new Error(`지원되지 않는 플랫폼: ${process.platform}`)
}

// ─── Tools ────────────────────────────────────────────────────────────────────

export const appLaunchTool: AgentTool<AppLaunchParams> = {
  name: "app_launch",
  description: "이름이나 경로로 애플리케이션을 실행합니다. (예: \"Chrome\", \"Safari\", \"Visual Studio Code\")",
  parameters: {
    type: "object",
    properties: {
      app: { type: "string", description: "앱 이름 (예: \"Chrome\") 또는 실행 파일 경로" },
      args: {
        type: "array",
        items: { type: "string" },
        description: "앱에 전달할 추가 인수 (선택)",
      },
      background: {
        type: "boolean",
        description: "백그라운드 실행 여부. 기본: true",
      },
    },
    required: ["app"],
  },
  riskLevel: "moderate",
  requiresApproval: true,

  async execute(params: AppLaunchParams): Promise<ToolResult> {
    const { app, args = [], background = true } = params
    const isPath = app.startsWith("/") || app.startsWith("./")

    // Require approval for direct executable paths
    if (isPath) {
      return {
        success: false,
        output: "직접 경로 실행은 보안상 허용되지 않습니다. 앱 이름으로 지정해주세요.",
      }
    }

    try {
      if (await canYeonjangHandleMethod("application.launch")) {
        const remote = await invokeYeonjangMethod<YeonjangApplicationLaunchResult>(
          "application.launch",
          {
            application: app,
            args,
            detached: background,
          },
          { timeoutMs: 15_000 },
        )
        return {
          success: remote.launched,
          output: remote.message || `"${app}" 실행`,
          details: { via: "yeonjang", application: remote.application, pid: remote.pid ?? null },
          ...(remote.launched ? {} : { error: "remote_launch_failed" }),
        }
      }
    } catch (error) {
      if (!isYeonjangUnavailableError(error)) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, output: `Yeonjang 앱 실행 실패: ${message}`, error: message }
      }
    }

    try {
      await launchApp(app, args, background)
      return {
        success: true,
        output: `"${app}" 실행${background ? " (백그라운드)" : ""}`,
        details: { via: "local" },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, output: `앱 실행 실패: ${msg}`, error: msg }
    }
  },
}

export const appListTool: AgentTool<AppListParams> = {
  name: "app_list",
  description: "설치된 애플리케이션 목록을 조회합니다.",
  parameters: {
    type: "object",
    properties: {
      filter: { type: "string", description: "앱 이름 필터 (부분 매칭)" },
    },
    required: [],
  },
  riskLevel: "safe",
  requiresApproval: false,

  async execute(params: AppListParams): Promise<ToolResult> {
    const { filter } = params

    if (process.platform !== "darwin" && process.platform !== "linux") {
      return { success: false, output: `이 플랫폼(${process.platform})에서는 app_list가 지원되지 않습니다.` }
    }

    try {
      const apps = await listApps(filter)
      if (apps.length === 0) {
        return {
          success: true,
          output: filter ? `"${filter}"과 일치하는 앱이 없습니다.` : "설치된 앱을 찾을 수 없습니다.",
        }
      }

      const lines = apps.map((a) => `• ${a.name}  (${a.path})`).join("\n")
      return {
        success: true,
        output: `설치된 앱 ${apps.length}개${filter ? ` (필터: "${filter}")` : ""}:\n\n${lines}`,
        details: { count: apps.length },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, output: `앱 목록 조회 실패: ${msg}`, error: msg }
    }
  },
}
