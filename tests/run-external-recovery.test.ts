import { describe, expect, it } from "vitest"
import { planExternalRecovery } from "../packages/core/src/runs/external-recovery.ts"

describe("external recovery planning", () => {
  it("stops when the same llm recovery repeats on the same route", () => {
    const seenKeys = new Set<string>()
    const firstPlan = planExternalRecovery({
      kind: "llm",
      taskProfile: "general_chat",
      current: {
        model: "gpt-4o-mini",
        providerId: "openai",
        provider: undefined,
        targetId: "provider:openai",
        targetLabel: "OpenAI",
        workerRuntime: undefined,
      },
      payload: {
        summary: "LLM 오류 복구",
        reason: "403 blocked",
        message: "challenge",
      },
      seenKeys,
      originalRequest: "hello",
      previousResult: "",
      dependencies: {
        resolveRoute: () => ({
          targetId: "provider:openai",
          targetLabel: "OpenAI",
          providerId: "openai",
          model: "gpt-4o-mini",
          reason: "same",
        }),
      },
    })

    seenKeys.add(firstPlan.recoveryKey)

    const repeatedPlan = planExternalRecovery({
      kind: "llm",
      taskProfile: "general_chat",
      current: {
        model: "gpt-4o-mini",
        providerId: "openai",
        provider: undefined,
        targetId: "provider:openai",
        targetLabel: "OpenAI",
        workerRuntime: undefined,
      },
      payload: {
        summary: "LLM 오류 복구",
        reason: "403 blocked",
        message: "challenge",
      },
      seenKeys,
      originalRequest: "hello",
      previousResult: "",
      dependencies: {
        resolveRoute: () => ({
          targetId: "provider:openai",
          targetLabel: "OpenAI",
          providerId: "openai",
          model: "gpt-4o-mini",
          reason: "same",
        }),
      },
    })

    expect(repeatedPlan.duplicateStop?.summary).toContain("같은 LLM 오류")
  })

  it("falls back from worker runtime to default inference path when route does not change", () => {
    const plan = planExternalRecovery({
      kind: "worker_runtime",
      taskProfile: "operations",
      current: {
        model: "gpt-4o-mini",
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
      payload: {
        summary: "worker 복구",
        reason: "runtime failed",
        message: "exit 1",
      },
      seenKeys: new Set(),
      originalRequest: "do work",
      previousResult: "partial",
      dependencies: {
        resolveRoute: () => ({
          targetId: "worker:claude_code",
          targetLabel: "Claude Code",
          providerId: "anthropic",
          model: "gpt-4o-mini",
          workerRuntime: {
            kind: "claude_code",
            label: "Claude Code",
            command: "claude",
            args: [],
            detect: { type: "command", command: "claude", args: ["--version"] },
          },
          reason: "same",
        }),
      },
    })

    expect(plan.routeChanged).toBe(false)
    expect(plan.nextState.workerRuntime).toBeUndefined()
    expect(plan.routeEventLabel).toContain("기본 추론 경로")
    expect(plan.nextMessage).toContain("[Worker Runtime Error Recovery]")
  })

  it("applies reroute when another target is available", () => {
    const plan = planExternalRecovery({
      kind: "llm",
      taskProfile: "general_chat",
      current: {
        model: "gpt-4o-mini",
        providerId: "openai",
        provider: undefined,
        targetId: "provider:openai",
        targetLabel: "OpenAI",
        workerRuntime: undefined,
      },
      payload: {
        summary: "llm 복구",
        reason: "rate limit",
        message: "too many requests",
      },
      seenKeys: new Set(),
      originalRequest: "hello",
      previousResult: "partial",
      dependencies: {
        resolveRoute: () => ({
          targetId: "worker:claude_code",
          targetLabel: "Claude Code",
          providerId: "anthropic",
          model: "claude-sonnet",
          workerRuntime: {
            kind: "claude_code",
            label: "Claude Code",
            command: "claude",
            args: [],
            detect: { type: "command", command: "claude", args: ["--version"] },
          },
          reason: "reroute",
        }),
      },
    })

    expect(plan.routeChanged).toBe(true)
    expect(plan.nextState.targetLabel).toBe("Claude Code")
    expect(plan.routeEventLabel).toContain("LLM 복구 경로 전환")
  })
})
