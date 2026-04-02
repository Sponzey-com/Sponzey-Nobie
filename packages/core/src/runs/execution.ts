import type { TaskExecutionSemantics } from "../agent/intake.js"
import { homedir } from "node:os"
import { extname, join, resolve } from "node:path"
import type { FailedCommandTool, SuccessfulToolEvidence } from "./recovery.js"

export type ToolExecutionExecutor = "yeonjang" | "local" | "file_tool" | "core"

export interface ToolExecutionReceipt {
  toolName: string
  success: boolean
  output: string
  summary: string
  executor: ToolExecutionExecutor
  successfulTool?: SuccessfulToolEvidence
  filesystemMutation: boolean
  mutationPaths: string[]
  commandFailure: boolean
  commandRecoveredWithinSamePass: boolean
}

export interface AppliedToolExecutionReceiptState {
  sawRealFilesystemMutation: boolean
  commandFailureSeen: boolean
  commandRecoveredWithinSamePass: boolean
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

export function allowsTextOnlyCompletion(params: { executionSemantics: TaskExecutionSemantics }): boolean {
  return params.executionSemantics.filesystemEffect === "none"
    && params.executionSemantics.privilegedOperation === "none"
    && params.executionSemantics.artifactDelivery === "none"
}

export function hasMeaningfulCompletionEvidence(params: {
  executionSemantics: TaskExecutionSemantics
  preview: string
  deliverySatisfied: boolean
  successfulTools: SuccessfulToolEvidence[]
  sawRealFilesystemMutation: boolean
}): boolean {
  if (params.deliverySatisfied) return true
  if (params.successfulTools.length > 0) return true
  if (params.sawRealFilesystemMutation) return true
  if (!params.preview.trim()) return false
  return allowsTextOnlyCompletion({ executionSemantics: params.executionSemantics })
}

export function buildImplicitExecutionSummary(params: {
  successfulTools: SuccessfulToolEvidence[]
  sawRealFilesystemMutation: boolean
}): string | undefined {
  const uniqueTools = [...new Set(params.successfulTools.map((tool) => tool.toolName).filter(Boolean))]
  if (uniqueTools.length > 0) {
    if (uniqueTools.length === 1) {
      return `${uniqueTools[0]} 실행을 완료했습니다.`
    }
    return `${uniqueTools.slice(0, 3).join(", ")} 실행을 완료했습니다.`
  }

  if (params.sawRealFilesystemMutation) {
    return "실제 파일 또는 폴더 작업을 완료했습니다."
  }

  return undefined
}

export function isRealFilesystemMutation(toolName: string, params: unknown): boolean {
  if (toolName === "file_write" || toolName === "file_patch" || toolName === "file_delete") {
    return true
  }

  if (toolName !== "shell_exec" || !params || typeof params !== "object") {
    return false
  }

  const command = getString((params as Record<string, unknown>).command)
  if (!command) return false

  const normalizedCommand = command
    .split("&&").join("\n")
    .split("||").join("\n")
    .split(";").join("\n")
  const segments = normalizedCommand
    .split("\n")
    .map((segment) => segment.trim())
    .filter(Boolean)

  return segments.some((segment) => {
    if (["mkdir ", "touch ", "cp ", "mv ", "install ", "rm ", "unzip ", "tar "].some((prefix) => segment.includes(prefix))) return true
    if (segment.includes("ln -s")) return true
    if (segment.includes("git clone")) return true
    if (segment.includes("npm install") || segment.includes("pnpm install")) return true
    if (segment.includes("tee") && segment.includes(">")) return true
    if ((segment.includes("cat") || segment.includes("printf") || segment.includes("echo")) && segment.includes(">")) return true
    return false
  })
}

export function normalizeFilesystemPath(value: string | undefined, workDir: string): string | undefined {
  if (!value) return undefined

  let trimmed = value.trim()
  if (!trimmed) return undefined

  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    trimmed = trimmed.slice(1, -1)
  }

  if (!trimmed) return undefined

  const home = homedir()
  if (trimmed.startsWith("~/")) return resolve(join(home, trimmed.slice(2)))
  if (trimmed.startsWith("$HOME/")) return resolve(join(home, trimmed.slice(6)))
  if (trimmed.startsWith("/")) return resolve(trimmed)

  for (const homeRelativePrefix of ["Downloads/", "Desktop/", "Documents/"] as const) {
    if (trimmed.startsWith(homeRelativePrefix)) {
      return resolve(join(home, trimmed))
    }
  }

  if (trimmed.startsWith("./") || trimmed.startsWith("../")) {
    return resolve(workDir, trimmed)
  }

  return undefined
}

export function collectFilesystemMutationPaths(toolName: string, params: unknown, workDir: string): string[] {
  if (!params || typeof params !== "object") return []
  const record = params as Record<string, unknown>

  if (toolName === "file_write" || toolName === "file_delete") {
    const path = normalizeFilesystemPath(getString(record.path), workDir)
    return path ? [path] : []
  }

  if (toolName === "file_patch") {
    const patch = getString(record.patch)
    if (!patch) return []

    const paths: string[] = []
    for (const line of patch.split("\n")) {
      for (const prefix of ["*** Add File: ", "*** Update File: ", "*** Delete File: "] as const) {
        if (!line.startsWith(prefix)) continue
        const rawPath = line.slice(prefix.length).trim()
        if (!rawPath) continue
        paths.push(normalizeFilesystemPath(rawPath, workDir) ?? resolve(workDir, rawPath))
      }
    }

    return [...new Set(paths)]
  }

  if (toolName !== "shell_exec") return []

  const command = getString(record.command)
  if (!command) return []

  const tokens = command
    .split("\n")
    .join(" ")
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)

  const paths = new Set<string>()
  for (const token of tokens) {
    const cleaned = token.replace(/^["'()]+|["'();,&|]+$/g, "")
    const normalized = normalizeFilesystemPath(cleaned, workDir)
    if (normalized) paths.add(normalized)
  }

  return [...paths]
}

export function inferFilesystemKindFromPath(path: string): "file" | "dir" {
  return extname(path) ? "file" : "dir"
}

export function buildToolExecutionReceipt(params: {
  toolName: string
  success: boolean
  output: string
  toolParams: unknown
  toolDetails?: unknown
  workDir: string
  commandFailureSeen: boolean
}): ToolExecutionReceipt {
  const filesystemMutation = params.success && isRealFilesystemMutation(params.toolName, params.toolParams)
  const mutationPaths = filesystemMutation
    ? collectFilesystemMutationPaths(params.toolName, params.toolParams, params.workDir)
    : []
  const commandFailure = !params.success && isCommandFailureRecoveryTool(params.toolName)
  const commandRecoveredWithinSamePass =
    params.success && isCommandFailureRecoveryTool(params.toolName) && params.commandFailureSeen
  const executor = inferToolExecutionExecutor(params.toolName, params.toolDetails)

  return {
    toolName: params.toolName,
    success: params.success,
    output: params.output,
    summary: params.success ? `${params.toolName} 실행 완료` : `${params.toolName} 실행 실패`,
    executor,
    ...(params.success ? { successfulTool: { toolName: params.toolName, output: params.output } } : {}),
    filesystemMutation,
    mutationPaths,
    commandFailure,
    commandRecoveredWithinSamePass,
  }
}

export function applyToolExecutionReceipt(params: {
  receipt: ToolExecutionReceipt
  successfulTools: SuccessfulToolEvidence[]
  filesystemMutationPaths: Set<string>
  failedCommandTools: FailedCommandTool[]
  toolParams: unknown
  previousCommandFailureSeen: boolean
}): AppliedToolExecutionReceiptState {
  const nextState: AppliedToolExecutionReceiptState = {
    sawRealFilesystemMutation: params.receipt.filesystemMutation,
    commandFailureSeen: params.previousCommandFailureSeen,
    commandRecoveredWithinSamePass: false,
  }

  if (params.receipt.successfulTool) {
    params.successfulTools.push(params.receipt.successfulTool)
  }

  if (params.receipt.filesystemMutation) {
    for (const mutationPath of params.receipt.mutationPaths) {
      params.filesystemMutationPaths.add(mutationPath)
    }
  }

  if (params.receipt.commandFailure) {
    nextState.commandFailureSeen = true
    params.failedCommandTools.push({
      toolName: params.receipt.toolName,
      output: params.receipt.output,
      ...(params.toolParams !== undefined ? { params: params.toolParams } : {}),
    })
  } else if (params.receipt.commandRecoveredWithinSamePass) {
    nextState.commandRecoveredWithinSamePass = true
    params.failedCommandTools.length = 0
  }

  return nextState
}

function isCommandFailureRecoveryTool(toolName: string): boolean {
  return toolName === "shell_exec" || toolName === "app_launch" || toolName === "process_kill"
}

function inferToolExecutionExecutor(toolName: string, toolDetails: unknown): ToolExecutionExecutor {
  if (toolName === "file_read" || toolName === "file_write" || toolName === "file_patch" || toolName === "file_delete") {
    return "file_tool"
  }

  if (toolDetails && typeof toolDetails === "object") {
    const via = getString((toolDetails as Record<string, unknown>).via)
    if (via === "yeonjang") return "yeonjang"
    if (via === "local") return "local"
  }

  return "core"
}
