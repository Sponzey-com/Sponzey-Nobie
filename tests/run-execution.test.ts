import { describe, expect, it } from "vitest"
import {
  applyToolExecutionReceipt,
  buildToolExecutionReceipt,
  buildImplicitExecutionSummary,
  collectFilesystemMutationPaths,
  hasMeaningfulCompletionEvidence,
  isRealFilesystemMutation,
  normalizeFilesystemPath,
} from "../packages/core/src/runs/execution.ts"

describe("run execution helpers", () => {
  it("detects real filesystem mutations from file tools and mutating shell commands", () => {
    expect(isRealFilesystemMutation("file_write", { path: "./hello.txt" })).toBe(true)
    expect(isRealFilesystemMutation("shell_exec", { command: "mkdir -p ./output && touch ./output/a.txt" })).toBe(true)
    expect(isRealFilesystemMutation("shell_exec", { command: "ls -la ./output" })).toBe(false)
  })

  it("collects mutation paths from file patch and shell command params", () => {
    const patchPaths = collectFilesystemMutationPaths(
      "file_patch",
      {
        patch: ["*** Begin Patch", "*** Add File: src/demo.txt", "+hello", "*** End Patch"].join("\n"),
      },
      "/tmp/work",
    )
    expect(patchPaths).toContain("/tmp/work/src/demo.txt")

    const shellPaths = collectFilesystemMutationPaths(
      "shell_exec",
      { command: "mkdir -p ./dist && cp ./a.txt ./dist/a.txt" },
      "/tmp/work",
    )
    expect(shellPaths).toContain("/tmp/work/dist")
    expect(shellPaths).toContain("/tmp/work/a.txt")
  })

  it("normalizes home-relative and workdir-relative filesystem paths", () => {
    const workdirPath = normalizeFilesystemPath("./src/index.ts", "/tmp/work")
    expect(workdirPath).toBe("/tmp/work/src/index.ts")

    const homePath = normalizeFilesystemPath("~/Downloads/demo.txt", "/tmp/work")
    expect(homePath).toContain("/Downloads/demo.txt")
  })

  it("builds implicit execution summaries and completion evidence from execution state", () => {
    expect(buildImplicitExecutionSummary({
      successfulTools: [{ toolName: "screen_capture", output: "ok" }],
      sawRealFilesystemMutation: false,
    })).toBe("screen_capture 실행을 완료했습니다.")

    expect(hasMeaningfulCompletionEvidence({
      executionSemantics: {
        filesystemEffect: "none",
        privilegedOperation: "none",
        artifactDelivery: "none",
        approvalRequired: false,
        approvalTool: "none",
      },
      preview: "요청을 처리했습니다.",
      deliverySatisfied: false,
      successfulTools: [],
      sawRealFilesystemMutation: false,
    })).toBe(true)

    expect(hasMeaningfulCompletionEvidence({
      executionSemantics: {
        filesystemEffect: "mutate",
        privilegedOperation: "none",
        artifactDelivery: "none",
        approvalRequired: false,
        approvalTool: "none",
      },
      preview: "",
      deliverySatisfied: false,
      successfulTools: [],
      sawRealFilesystemMutation: false,
    })).toBe(false)
  })

  it("builds structured tool execution receipts for success and failure cases", () => {
    const successReceipt = buildToolExecutionReceipt({
      toolName: "file_write",
      success: true,
      output: "written",
      toolParams: { path: "./demo.txt" },
      toolDetails: { path: "/tmp/work/demo.txt" },
      workDir: "/tmp/work",
      commandFailureSeen: false,
    })

    expect(successReceipt.summary).toBe("file_write 실행 완료")
    expect(successReceipt.executor).toBe("file_tool")
    expect(successReceipt.successfulTool?.toolName).toBe("file_write")
    expect(successReceipt.filesystemMutation).toBe(true)
    expect(successReceipt.mutationPaths).toContain("/tmp/work/demo.txt")
    expect(successReceipt.commandFailure).toBe(false)

    const yeonjangReceipt = buildToolExecutionReceipt({
      toolName: "screen_capture",
      success: true,
      output: "captured",
      toolParams: { display: "main" },
      toolDetails: { via: "yeonjang", mimeType: "image/png" },
      workDir: "/tmp/work",
      commandFailureSeen: false,
    })

    expect(yeonjangReceipt.executor).toBe("yeonjang")

    const localReceipt = buildToolExecutionReceipt({
      toolName: "mouse_click",
      success: true,
      output: "clicked",
      toolParams: { x: 10, y: 20 },
      toolDetails: { via: "local" },
      workDir: "/tmp/work",
      commandFailureSeen: false,
    })

    expect(localReceipt.executor).toBe("local")

    const failureReceipt = buildToolExecutionReceipt({
      toolName: "shell_exec",
      success: false,
      output: "command not found",
      toolParams: { command: "missing-command" },
      toolDetails: { via: "local", exitCode: 127 },
      workDir: "/tmp/work",
      commandFailureSeen: false,
    })

    expect(failureReceipt.summary).toBe("shell_exec 실행 실패")
    expect(failureReceipt.executor).toBe("local")
    expect(failureReceipt.successfulTool).toBeUndefined()
    expect(failureReceipt.commandFailure).toBe(true)
    expect(failureReceipt.commandRecoveredWithinSamePass).toBe(false)
  })

  it("applies tool execution receipts to accumulated execution state", () => {
    const successfulTools: Array<{ toolName: string; output: string }> = []
    const failedCommandTools: Array<{ toolName: string; output: string; params?: unknown }> = []
    const filesystemMutationPaths = new Set<string>()

    const successState = applyToolExecutionReceipt({
      receipt: buildToolExecutionReceipt({
        toolName: "screen_capture",
        success: true,
        output: "captured",
        toolParams: { display: "main" },
        toolDetails: { via: "yeonjang" },
        workDir: "/tmp/work",
        commandFailureSeen: false,
      }),
      successfulTools,
      filesystemMutationPaths,
      failedCommandTools,
      toolParams: { display: "main" },
      previousCommandFailureSeen: false,
    })

    expect(successState.sawRealFilesystemMutation).toBe(false)
    expect(successState.commandFailureSeen).toBe(false)
    expect(successfulTools).toHaveLength(1)

    const failureState = applyToolExecutionReceipt({
      receipt: buildToolExecutionReceipt({
        toolName: "shell_exec",
        success: false,
        output: "command not found",
        toolParams: { command: "missing-command" },
        toolDetails: { via: "local" },
        workDir: "/tmp/work",
        commandFailureSeen: false,
      }),
      successfulTools,
      filesystemMutationPaths,
      failedCommandTools,
      toolParams: { command: "missing-command" },
      previousCommandFailureSeen: false,
    })

    expect(failureState.commandFailureSeen).toBe(true)
    expect(failureState.commandRecoveredWithinSamePass).toBe(false)
    expect(failedCommandTools).toHaveLength(1)
    expect(failedCommandTools[0]?.toolName).toBe("shell_exec")
  })
})
