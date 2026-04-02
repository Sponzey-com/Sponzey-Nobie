import { describe, expect, it, vi } from "vitest"
import { applyExternalRecoveryPlan } from "../packages/core/src/runs/external-recovery-application.ts"

describe("external recovery application", () => {
  it("moves to stop when duplicate stop is requested", async () => {
    const appendRunEvent = vi.fn()
    const applyTerminalApplication = vi.fn(async () => ({ kind: "stop" }))

    const result = await applyExternalRecoveryPlan({
      runId: "run-1",
      sessionId: "session-1",
      source: "telegram",
      onChunk: undefined,
      preview: "partial",
      plan: {
        recoveryKey: "dup-1",
        eventLabel: "LLM 오류를 분석하고 다른 방법으로 재시도합니다.",
        routeChanged: false,
        nextState: {
          model: "gpt-4o-mini",
          providerId: "openai",
          provider: undefined,
          targetId: "provider:openai",
          targetLabel: "OpenAI",
          workerRuntime: undefined,
        },
        nextMessage: "retry prompt",
        duplicateStop: {
          summary: "같은 LLM 오류가 반복되었습니다.",
          reason: "403 blocked",
          remainingItems: ["다른 수동 조치 필요"],
        },
      },
      seenKeys: new Set<string>(),
      finalizationDependencies: {
        appendRunEvent: vi.fn(),
        setRunStepStatus: vi.fn(),
        updateRunStatus: vi.fn(),
        rememberRunSuccess: vi.fn(),
        rememberRunFailure: vi.fn(),
      },
    }, {
      appendRunEvent,
    }, {
      applyTerminalApplication,
    })

    expect(result).toEqual({ kind: "stop" })
    expect(applyTerminalApplication).toHaveBeenCalledTimes(1)
    expect(appendRunEvent).not.toHaveBeenCalled()
  })

  it("applies recovery events and state when retry continues", async () => {
    const seenKeys = new Set<string>()
    const appendRunEvent = vi.fn()

    const result = await applyExternalRecoveryPlan({
      runId: "run-2",
      sessionId: "session-2",
      source: "webui",
      onChunk: undefined,
      preview: "",
      plan: {
        recoveryKey: "llm-1",
        eventLabel: "LLM 오류를 분석하고 다른 방법으로 재시도합니다.",
        routeChanged: true,
        routeEventLabel: "LLM 복구 경로 전환: OpenAI -> Claude Code",
        nextState: {
          model: "claude-sonnet",
          providerId: "anthropic",
          provider: undefined,
          targetId: "worker:claude_code",
          targetLabel: "Claude Code",
          workerRuntime: {
            kind: "claude_code",
            label: "Claude Code",
            command: "claude",
            args: [],
            detect: { type: "command", command: "claude", args: ["--version"] },
          },
        },
        nextMessage: "retry prompt",
      },
      seenKeys,
      finalizationDependencies: {
        appendRunEvent: vi.fn(),
        setRunStepStatus: vi.fn(),
        updateRunStatus: vi.fn(),
        rememberRunSuccess: vi.fn(),
        rememberRunFailure: vi.fn(),
      },
    }, {
      appendRunEvent,
    })

    expect(result).toEqual({
      kind: "retry",
      nextState: {
        model: "claude-sonnet",
        providerId: "anthropic",
        provider: undefined,
        targetId: "worker:claude_code",
        targetLabel: "Claude Code",
        workerRuntime: {
          kind: "claude_code",
          label: "Claude Code",
          command: "claude",
          args: [],
          detect: { type: "command", command: "claude", args: ["--version"] },
        },
      },
      nextMessage: "retry prompt",
    })
    expect(seenKeys.has("llm-1")).toBe(true)
    expect(appendRunEvent).toHaveBeenNthCalledWith(1, "run-2", "LLM 오류를 분석하고 다른 방법으로 재시도합니다.")
    expect(appendRunEvent).toHaveBeenNthCalledWith(2, "run-2", "LLM 복구 경로 전환: OpenAI -> Claude Code")
  })
})
