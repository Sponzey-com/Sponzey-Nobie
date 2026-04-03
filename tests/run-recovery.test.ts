import { describe, expect, it } from "vitest"
import {
  buildAiRecoveryKey,
  describeAssistantTextDeliveryFailure,
  describeRecoveryAlternatives,
  hasMeaningfulRouteChange,
  selectCommandFailureRecovery,
  selectDirectArtifactDeliveryRecovery,
  selectGenericExecutionRecovery,
  shouldRetryTruncatedOutput,
} from "../packages/core/src/runs/recovery.ts"

describe("run recovery helpers", () => {
  it("classifies auth-like AI recovery failures into a stable key", () => {
    const key = buildAiRecoveryKey({
      targetId: "provider:openai",
      workerRuntimeKind: undefined,
      providerId: "openai",
      model: "gpt-4.1",
      reason: "모델 호출 실패",
      message: "403 Forbidden: Cloudflare challenge page returned by upstream",
    })

    expect(key).toBe("provider:openai::auth")
  })

  it("returns a recovery candidate for unseen command failures", () => {
    const recovery = selectCommandFailureRecovery({
      failedTools: [
        {
          toolName: "shell_exec",
          output: "command not found: screencapture",
        },
      ],
      commandFailureSeen: true,
      commandRecoveredWithinSamePass: false,
      seenKeys: new Set<string>(),
    })

    expect(recovery).not.toBeNull()
    expect(recovery?.summary).toContain("shell_exec")
    expect(recovery?.reason).toContain("실행 명령을 찾지 못해")
    expect(recovery?.alternatives.some((alternative) => alternative.kind === "other_tool")).toBe(true)
    expect(recovery?.alternatives.some((alternative) => alternative.kind === "other_extension")).toBe(true)
  })

  it("returns a delivery recovery candidate for missing direct artifact delivery", () => {
    const recovery = selectDirectArtifactDeliveryRecovery({
      source: "webui",
      successfulFileDeliveries: [],
      seenKeys: new Set<string>(),
    })

    expect(recovery).not.toBeNull()
    expect(recovery?.summary).toContain("메신저 결과 전달")
    expect(recovery?.remainingItems[0]).toContain("결과물 자체")
    expect(recovery?.alternatives.some((alternative) => alternative.kind === "same_channel_retry")).toBe(true)
    expect(recovery?.alternatives.some((alternative) => alternative.kind === "other_channel")).toBe(true)
  })

  it("describes assistant text delivery failure by channel and stage", () => {
    const summary = describeAssistantTextDeliveryFailure({
      source: "telegram",
      outcome: {
        persisted: true,
        textDelivered: true,
        doneDelivered: false,
        hasDeliveryFailure: true,
        failureStage: "done",
        summary: "응답 완료 신호 전달에 실패했습니다.",
      },
    })

    expect(summary).toBe("텔레그램 응답 완료 신호 전달에 실패했습니다.")
  })

  it("skips generic execution recovery when the same failure key was already used", () => {
    const seenKeys = new Set<string>(["create_schedule:timeout while registering schedule"])
    const recovery = selectGenericExecutionRecovery({
      executionRecovery: {
        summary: "create_schedule 실패 후 다른 방법을 찾습니다.",
        reason: "timeout while registering schedule",
        toolNames: ["create_schedule"],
      },
      seenKeys,
    })

    expect(recovery).toBeNull()
  })

  it("describes recovery alternatives and includes schedule alternatives for schedule-like failures", () => {
    const recovery = selectGenericExecutionRecovery({
      executionRecovery: {
        summary: "create_schedule 실패 후 다른 방법을 찾습니다.",
        reason: "invalid schedule registration path",
        toolNames: ["create_schedule", "screen_capture"],
      },
      seenKeys: new Set<string>(),
    })

    expect(recovery).not.toBeNull()
    expect(recovery?.alternatives.some((alternative) => alternative.kind === "other_schedule")).toBe(true)
    expect(recovery?.alternatives.some((alternative) => alternative.kind === "other_extension")).toBe(true)
    expect(describeRecoveryAlternatives(recovery?.alternatives ?? [])).toContain("대안 후보:")
  })

  it("detects meaningful route changes across provider or worker transitions", () => {
    expect(hasMeaningfulRouteChange({
      currentTargetId: "provider:openai",
      currentModel: "gpt-4.1",
      currentProviderId: "openai",
      currentWorkerRuntimeKind: undefined,
      nextTargetId: "provider:openai",
      nextModel: "gpt-4.1",
      nextProviderId: "openai",
      nextWorkerRuntimeKind: undefined,
    })).toBe(false)

    expect(hasMeaningfulRouteChange({
      currentTargetId: "worker:internal_ai",
      currentModel: "gpt-4.1",
      currentProviderId: "openai",
      currentWorkerRuntimeKind: "internal_ai",
      nextTargetId: "provider:openai",
      nextModel: "gpt-4.1",
      nextProviderId: "openai",
      nextWorkerRuntimeKind: undefined,
    })).toBe(true)
  })

  it("retries truncated output only for filesystem tasks awaiting user after incomplete results", () => {
    expect(shouldRetryTruncatedOutput({
      review: {
        status: "ask_user",
        summary: "출력이 중간에 절단되었습니다.",
        reason: "incomplete result",
        remainingItems: ["파일을 끝까지 써야 합니다."],
      },
      preview: "function buildPage() {",
      requiresFilesystemMutation: true,
    })).toBe(true)

    expect(shouldRetryTruncatedOutput({
      review: {
        status: "ask_user",
        summary: "추가 입력이 필요합니다.",
      },
      preview: "done",
      requiresFilesystemMutation: false,
    })).toBe(false)
  })
})
