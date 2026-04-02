import { describe, expect, it, vi } from "vitest"
import { runExternalRecoveryPass } from "../packages/core/src/runs/external-recovery-pass.ts"

describe("external recovery pass", () => {
  it("returns none when there is no payload", async () => {
    const result = await runExternalRecoveryPass({
      kind: "llm",
      aborted: false,
      taskProfile: "general_chat",
      current: {
        model: "gpt-4o-mini",
        providerId: "openai",
        provider: undefined,
        targetId: "provider:openai",
        targetLabel: "OpenAI",
        workerRuntime: undefined,
      },
      seenKeys: new Set<string>(),
      originalRequest: "안녕이라고 말해줘",
      previousResult: "안녕",
      runId: "run-1",
      sessionId: "session-1",
      source: "telegram",
      onChunk: undefined,
      preview: "안녕",
      finalizationDependencies: {
        appendRunEvent: vi.fn(),
        setRunStepStatus: vi.fn(),
        updateRunStatus: vi.fn(),
        rememberRunSuccess: vi.fn(),
        rememberRunFailure: vi.fn(),
      },
    }, {
      appendRunEvent: vi.fn(),
    })

    expect(result).toEqual({ kind: "none" })
  })

  it("plans and applies llm recovery when retry continues", async () => {
    const appendRunEvent = vi.fn()
    const planExternalRecovery = vi.fn().mockReturnValue({
      recoveryKey: "llm-1",
      eventLabel: "LLM 오류를 분석하고 다른 방법으로 재시도합니다.",
      routeChanged: true,
      nextState: {
        model: "claude-sonnet",
        providerId: "anthropic",
        provider: undefined,
        targetId: "worker:claude_code",
        targetLabel: "Claude Code",
        workerRuntime: undefined,
      },
      nextMessage: "retry prompt",
    })
    const applyExternalRecoveryPlan = vi.fn().mockResolvedValue({
      kind: "retry",
      nextState: {
        model: "claude-sonnet",
        providerId: "anthropic",
        provider: undefined,
        targetId: "worker:claude_code",
        targetLabel: "Claude Code",
        workerRuntime: undefined,
      },
      nextMessage: "retry prompt",
    })

    const result = await runExternalRecoveryPass({
      kind: "llm",
      payload: {
        summary: "LLM 오류를 분석하고 다른 방법으로 재시도합니다.",
        reason: "403 blocked",
        message: "forbidden",
      },
      aborted: false,
      taskProfile: "general_chat",
      current: {
        model: "gpt-4o-mini",
        providerId: "openai",
        provider: undefined,
        targetId: "provider:openai",
        targetLabel: "OpenAI",
        workerRuntime: undefined,
      },
      seenKeys: new Set<string>(),
      originalRequest: "안녕이라고 말해줘",
      previousResult: "안녕",
      runId: "run-2",
      sessionId: "session-2",
      source: "webui",
      onChunk: undefined,
      preview: "안녕",
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
      planExternalRecovery,
      applyExternalRecoveryPlan,
    })

    expect(planExternalRecovery).toHaveBeenCalledWith(expect.objectContaining({
      kind: "llm",
      payload: {
        summary: "LLM 오류를 분석하고 다른 방법으로 재시도합니다.",
        reason: "403 blocked",
        message: "forbidden",
      },
    }))
    expect(applyExternalRecoveryPlan).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-2",
      sessionId: "session-2",
      source: "webui",
      preview: "안녕",
    }), {
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
        workerRuntime: undefined,
      },
      nextMessage: "retry prompt",
    })
  })

  it("returns stop when recovery application stops", async () => {
    const result = await runExternalRecoveryPass({
      kind: "worker_runtime",
      payload: {
        summary: "작업 세션 오류를 분석하고 다른 방법으로 재시도합니다.",
        reason: "sandbox denied",
        message: "command failed",
      },
      aborted: false,
      taskProfile: "operations",
      current: {
        model: "gpt-4o-mini",
        providerId: "openai",
        provider: undefined,
        targetId: "provider:openai",
        targetLabel: "OpenAI",
        workerRuntime: undefined,
      },
      seenKeys: new Set<string>(),
      originalRequest: "파일을 생성해줘",
      previousResult: "partial",
      runId: "run-3",
      sessionId: "session-3",
      source: "telegram",
      onChunk: undefined,
      preview: "partial",
      finalizationDependencies: {
        appendRunEvent: vi.fn(),
        setRunStepStatus: vi.fn(),
        updateRunStatus: vi.fn(),
        rememberRunSuccess: vi.fn(),
        rememberRunFailure: vi.fn(),
      },
    }, {
      appendRunEvent: vi.fn(),
    }, {
      planExternalRecovery: vi.fn().mockReturnValue({
        recoveryKey: "worker-1",
        eventLabel: "작업 세션 오류를 분석하고 다른 방법으로 재시도합니다.",
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
      }),
      applyExternalRecoveryPlan: vi.fn().mockResolvedValue({ kind: "stop" }),
    })

    expect(result).toEqual({ kind: "stop" })
  })
})
