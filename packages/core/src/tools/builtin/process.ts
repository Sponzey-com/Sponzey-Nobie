import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { AgentTool, ToolResult } from "../types.js"

const execFileAsync = promisify(execFile)

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProcessInfo {
  pid: number
  name: string
  cpu: number
  mem: number
  command: string
}

interface ProcessListParams {
  filter?: string
  sortBy?: "cpu" | "memory" | "pid" | "name"
  limit?: number
}

interface ProcessKillParams {
  pid?: number
  name?: string
  signal?: "SIGTERM" | "SIGKILL"
}

function yeonjangRequiredFailure(reason: string): ToolResult {
  return {
    success: false,
    output: `이 작업은 Yeonjang 연장을 통해서만 실행할 수 있습니다. ${reason}`,
    error: "YEONJANG_REQUIRED",
    details: {
      requiredExecutor: "yeonjang",
    },
  }
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

async function getProcesses(): Promise<ProcessInfo[]> {
  const platform = process.platform

  if (platform === "win32") {
    const { stdout } = await execFileAsync("tasklist", ["/FO", "CSV", "/NH"])
    return parseWindows(stdout)
  }

  // macOS / Linux
  const { stdout } = await execFileAsync("ps", ["aux", "--no-header"].filter(
    (a) => platform !== "darwin" || a !== "--no-header",
  ))
  return parsePsAux(stdout)
}

function parsePsAux(output: string): ProcessInfo[] {
  const results: ProcessInfo[] = []
  for (const line of output.split("\n")) {
    const parts = line.trim().split(/\s+/)
    // USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND...
    if (parts.length < 11) continue
    const pid = parseInt(parts[1] ?? "0", 10)
    const cpu = parseFloat(parts[2] ?? "0")
    const mem = parseFloat(parts[3] ?? "0")
    const command = parts.slice(10).join(" ")
    const name = (parts[10] ?? "").split("/").at(-1) ?? ""
    if (!pid || isNaN(pid)) continue
    results.push({ pid, name, cpu, mem, command })
  }
  return results
}

function parseWindows(output: string): ProcessInfo[] {
  const results: ProcessInfo[] = []
  for (const line of output.split("\n")) {
    const parts = line.trim().split(",").map((s) => s.replace(/^"|"$/g, ""))
    if (parts.length < 2) continue
    const name = parts[0] ?? ""
    const pid = parseInt(parts[1] ?? "0", 10)
    if (!pid || isNaN(pid)) continue
    results.push({ pid, name, cpu: 0, mem: 0, command: name })
  }
  return results
}

function formatTable(procs: ProcessInfo[]): string {
  const header = `${"PID".padStart(7)}  ${"CPU%".padStart(5)}  ${"MEM%".padStart(5)}  NAME`
  const divider = "-".repeat(header.length)
  const rows = procs.map((p) =>
    `${String(p.pid).padStart(7)}  ${p.cpu.toFixed(1).padStart(5)}  ${p.mem.toFixed(1).padStart(5)}  ${p.name}`,
  )
  return [header, divider, ...rows].join("\n")
}

// ─── Tools ────────────────────────────────────────────────────────────────────

export const processListTool: AgentTool<ProcessListParams> = {
  name: "process_list",
  description: "현재 실행 중인 시스템 프로세스 목록을 반환합니다.",
  parameters: {
    type: "object",
    properties: {
      filter: { type: "string", description: "프로세스 이름 필터 (부분 매칭)" },
      sortBy: {
        type: "string",
        enum: ["cpu", "memory", "pid", "name"],
        description: "정렬 기준. 기본: cpu",
      },
      limit: { type: "number", description: "최대 결과 수. 기본: 20" },
    },
    required: [],
  },
  riskLevel: "safe",
  requiresApproval: false,

  async execute(params: ProcessListParams): Promise<ToolResult> {
    const { filter, sortBy = "cpu", limit = 20 } = params

    let procs: ProcessInfo[]
    try {
      procs = await getProcesses()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, output: `프로세스 목록 조회 실패: ${msg}`, error: msg }
    }

    if (filter) {
      const lf = filter.toLowerCase()
      procs = procs.filter((p) => p.name.toLowerCase().includes(lf) || p.command.toLowerCase().includes(lf))
    }

    // Sort
    procs.sort((a, b) => {
      switch (sortBy) {
        case "memory": return b.mem - a.mem
        case "pid": return a.pid - b.pid
        case "name": return a.name.localeCompare(b.name)
        default: return b.cpu - a.cpu
      }
    })

    procs = procs.slice(0, limit)

    if (procs.length === 0) {
      return { success: true, output: filter ? `"${filter}"과 일치하는 프로세스가 없습니다.` : "실행 중인 프로세스가 없습니다." }
    }

    return {
      success: true,
      output: formatTable(procs),
      details: { count: procs.length },
    }
  },
}

export const processKillTool: AgentTool<ProcessKillParams> = {
  name: "process_kill",
  description: "지정한 프로세스를 종료합니다. PID 또는 이름으로 지정 가능.",
  parameters: {
    type: "object",
    properties: {
      pid: { type: "number", description: "종료할 프로세스 PID" },
      name: { type: "string", description: "종료할 프로세스 이름 (전체 일치)" },
      signal: {
        type: "string",
        enum: ["SIGTERM", "SIGKILL"],
        description: "전송할 시그널. 기본: SIGTERM (graceful). SIGKILL: 강제 종료",
      },
    },
    required: [],
  },
  riskLevel: "dangerous",
  requiresApproval: true,

  async execute(params: ProcessKillParams): Promise<ToolResult> {
    const targetDescription = params.pid != null
      ? `PID ${params.pid}`
      : params.name
        ? `프로세스 "${params.name}"`
        : "대상 프로세스"
    const signalLabel = params.signal ?? "SIGTERM"
    return yeonjangRequiredFailure(`${targetDescription} 종료(${signalLabel})는 현재 코어 로컬 경로에서 금지되어 있습니다.`)
  },
}
