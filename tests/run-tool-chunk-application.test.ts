import { describe, expect, it, vi } from "vitest"
import { applyToolEndChunk, applyToolStartChunk } from "../packages/core/src/runs/tool-chunk-application.ts"

describe("tool chunk application", () => {
  it("tracks pending params and emits tool start summary", () => {
    const pendingToolParams = new Map<string, unknown>()
    const appendRunEvent = vi.fn()
    const updateRunSummary = vi.fn()

    applyToolStartChunk({
      runId: "run-1",
      toolName: "screen_capture",
      toolParams: { display: "main" },
      pendingToolParams,
    }, {
      appendRunEvent,
      updateRunSummary,
    })

    expect(pendingToolParams.get("screen_capture")).toEqual({ display: "main" })
    expect(appendRunEvent).toHaveBeenCalledWith("run-1", "screen_capture 실행 시작")
    expect(updateRunSummary).toHaveBeenCalledWith("run-1", "screen_capture 실행 중")
  })

  it("applies tool end receipt and clears pending params", () => {
    const pendingToolParams = new Map<string, unknown>([["file_write", { path: "./demo.txt" }]])
    const successfulTools: Array<{ toolName: string; output: string }> = []
    const failedCommandTools: Array<{ toolName: string; output: string; params?: unknown }> = []
    const filesystemMutationPaths = new Set<string>()
    const appendRunEvent = vi.fn()
    const updateRunSummary = vi.fn()

    const result = applyToolEndChunk({
      runId: "run-2",
      toolName: "file_write",
      success: true,
      output: "written",
      toolDetails: { path: "/tmp/work/demo.txt" },
      workDir: "/tmp/work",
      pendingToolParams,
      successfulTools,
      filesystemMutationPaths,
      failedCommandTools,
      commandFailureSeen: false,
    }, {
      appendRunEvent,
      updateRunSummary,
    })

    expect(pendingToolParams.has("file_write")).toBe(false)
    expect(result.sawRealFilesystemMutation).toBe(true)
    expect(successfulTools).toEqual([{ toolName: "file_write", output: "written" }])
    expect([...filesystemMutationPaths]).toContain("/tmp/work/demo.txt")
    expect(appendRunEvent).toHaveBeenCalledWith("run-2", "file_write 실행 완료")
    expect(updateRunSummary).toHaveBeenCalledWith("run-2", "file_write 실행 완료")
  })

  it("propagates command failure state for failed shell tools", () => {
    const pendingToolParams = new Map<string, unknown>([["shell_exec", { command: "missing" }]])
    const failedCommandTools: Array<{ toolName: string; output: string; params?: unknown }> = []

    const result = applyToolEndChunk({
      runId: "run-3",
      toolName: "shell_exec",
      success: false,
      output: "command not found",
      toolDetails: { via: "local" },
      workDir: "/tmp/work",
      pendingToolParams,
      successfulTools: [],
      filesystemMutationPaths: new Set<string>(),
      failedCommandTools,
      commandFailureSeen: false,
    }, {
      appendRunEvent: vi.fn(),
      updateRunSummary: vi.fn(),
    })

    expect(result.commandFailureSeen).toBe(true)
    expect(failedCommandTools[0]?.toolName).toBe("shell_exec")
  })
})
