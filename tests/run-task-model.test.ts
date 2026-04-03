import { describe, expect, it } from "vitest"
import { buildTaskModels } from "../packages/core/src/runs/task-model.js"
import type { RootRun } from "../packages/core/src/runs/types.js"

function makeRun(overrides: Partial<RootRun> & Pick<RootRun, "id" | "requestGroupId" | "prompt">): RootRun {
  const now = 1_710_000_000_000
  return {
    id: overrides.id,
    sessionId: overrides.sessionId ?? "session-1",
    requestGroupId: overrides.requestGroupId,
    title: overrides.title ?? overrides.prompt,
    prompt: overrides.prompt,
    source: overrides.source ?? "telegram",
    status: overrides.status ?? "running",
    taskProfile: overrides.taskProfile ?? "general_chat",
    contextMode: overrides.contextMode ?? "full",
    delegationTurnCount: overrides.delegationTurnCount ?? 0,
    maxDelegationTurns: overrides.maxDelegationTurns ?? 5,
    currentStepKey: overrides.currentStepKey ?? "executing",
    currentStepIndex: overrides.currentStepIndex ?? 4,
    totalSteps: overrides.totalSteps ?? 9,
    summary: overrides.summary ?? overrides.prompt,
    canCancel: overrides.canCancel ?? true,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    steps: overrides.steps ?? [],
    recentEvents: overrides.recentEvents ?? [],
    ...(overrides.targetId ? { targetId: overrides.targetId } : {}),
    ...(overrides.targetLabel ? { targetLabel: overrides.targetLabel } : {}),
    ...(overrides.workerRuntimeKind ? { workerRuntimeKind: overrides.workerRuntimeKind } : {}),
    ...(overrides.workerSessionId ? { workerSessionId: overrides.workerSessionId } : {}),
  }
}

describe("buildTaskModels", () => {
  it("keeps one task while multiple attempts accumulate in the same request group", () => {
    const runs = [
      makeRun({
        id: "run-root",
        requestGroupId: "task-1",
        prompt: "Take a screenshot and send it back",
        status: "failed",
        summary: "첫 실행이 실패했습니다.",
        createdAt: 1,
        updatedAt: 2,
      }),
      makeRun({
        id: "run-retry",
        requestGroupId: "task-1",
        prompt: "[Approval Granted Continuation]\nTask: Take a screenshot and send it back",
        status: "running",
        summary: "승인 후 다시 진행 중입니다.",
        createdAt: 3,
        updatedAt: 4,
      }),
    ]

    const tasks = buildTaskModels(runs)

    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.id).toBe("task-1")
    expect(tasks[0]?.latestAttemptId).toBe("run-retry")
    expect(tasks[0]?.runIds).toEqual(["run-root", "run-retry"])
    expect(tasks[0]?.attempts.map((attempt) => attempt.id)).toEqual(["run-root", "run-retry"])
    expect(tasks[0]?.attempts.map((attempt) => attempt.prompt)).toEqual([
      "Take a screenshot and send it back",
      "[Approval Granted Continuation]\nTask: Take a screenshot and send it back",
    ])
    expect(tasks[0]?.status).toBe("running")
    expect(tasks[0]?.monitor).toEqual({
      activeAttemptCount: 1,
      runningAttemptCount: 1,
      queuedAttemptCount: 0,
      visibleAttemptCount: 1,
      internalAttemptCount: 1,
      recoveryAttemptCount: 0,
      activeRecoveryCount: 0,
      duplicateExecutionRisk: false,
      awaitingApproval: false,
      awaitingUser: false,
      deliveryStatus: "not_requested",
    })
    expect(tasks[0]?.checklist).toEqual({
      items: [
        { key: "request", status: "completed", summary: "첫 실행이 실패했습니다." },
        { key: "execution", status: "running", summary: "승인 후 다시 진행 중입니다." },
        { key: "delivery", status: "not_required" },
        { key: "completion", status: "running", summary: "승인 후 다시 진행 중입니다." },
      ],
      completedCount: 1,
      actionableCount: 3,
      failedCount: 0,
    })
  })

  it("classifies recovery attempts separately and keeps them out of the default user-visible set", () => {
    const runs = [
      makeRun({
        id: "run-root",
        requestGroupId: "task-2",
        prompt: "Export the report",
        status: "completed",
        summary: "처음 실행이 끝났습니다.",
        createdAt: 10,
        updatedAt: 11,
      }),
      makeRun({
        id: "run-recovery",
        requestGroupId: "task-2",
        prompt: "[Truncated Output Recovery]\nTask: Export the report",
        status: "running",
        summary: "중간 절단 복구를 다시 시도합니다.",
        createdAt: 12,
        updatedAt: 13,
      }),
      makeRun({
        id: "run-verify",
        requestGroupId: "task-2",
        prompt: "[Filesystem Verification]\nTask: Export the report",
        status: "completed",
        summary: "결과 검증 완료",
        createdAt: 14,
        updatedAt: 15,
      }),
    ]

    const task = buildTaskModels(runs)[0]

    expect(task?.attempts.map((attempt) => attempt.kind)).toEqual([
      "primary",
      "truncated_recovery",
      "verification",
    ])
    expect(task?.attempts.map((attempt) => attempt.userVisible)).toEqual([true, false, false])
    expect(task?.recoveryAttempts).toEqual([
      {
        id: "run-recovery",
        taskId: "task-2",
        sourceAttemptId: "run-root",
        kind: "truncated_output",
        status: "running",
        summary: "중간 절단 복구를 다시 시도합니다.",
        userVisible: false,
        createdAt: 12,
        updatedAt: 13,
      },
    ])
    expect(task?.monitor).toEqual({
      activeAttemptCount: 1,
      runningAttemptCount: 1,
      queuedAttemptCount: 0,
      visibleAttemptCount: 1,
      internalAttemptCount: 2,
      recoveryAttemptCount: 1,
      activeRecoveryCount: 1,
      duplicateExecutionRisk: false,
      awaitingApproval: false,
      awaitingUser: false,
      deliveryStatus: "not_requested",
    })
    expect(task?.activities.map((activity) => activity.kind)).toEqual([
      "attempt.completed",
      "attempt.started",
      "recovery.started",
      "attempt.completed",
      "attempt.started",
    ])
  })

  it("tracks delivery as a separate task state from run terminal status", () => {
    const deliveredTask = buildTaskModels([
      makeRun({
        id: "run-delivered",
        requestGroupId: "task-3",
        prompt: "Send the screenshot",
        status: "completed",
        summary: "스크린샷을 보냈습니다.",
        recentEvents: [{ id: "evt-1", at: 1, label: "텔레그램 파일 전달 완료: /tmp/screenshot.png" }],
      }),
    ])[0]

    const failedTask = buildTaskModels([
      makeRun({
        id: "run-failed-delivery",
        requestGroupId: "task-4",
        prompt: "Send the screenshot",
        status: "failed",
        summary: "텔레그램 전달이 실패했습니다.",
        recentEvents: [{ id: "evt-2", at: 1, label: "텔레그램 응답 완료 신호 전달에 실패했습니다." }],
      }),
    ])[0]

    expect(deliveredTask?.delivery).toEqual({
      taskId: "task-3",
      status: "delivered",
      sourceAttemptId: "run-delivered",
      channel: "telegram",
      summary: "텔레그램 파일 전달 완료: /tmp/screenshot.png",
    })
    expect(failedTask?.delivery).toEqual({
      taskId: "task-4",
      status: "failed",
      sourceAttemptId: "run-failed-delivery",
      channel: "telegram",
      summary: "텔레그램 응답 완료 신호 전달에 실패했습니다.",
    })
    expect(failedTask?.failure).toEqual({
      kind: "delivery",
      status: "failed",
      title: "전달 실패",
      summary: "텔레그램 응답 완료 신호 전달에 실패했습니다.",
      detailLines: [],
      sourceAttemptId: "run-failed-delivery",
    })
    expect(deliveredTask?.activities.find((activity) => activity.kind === "delivery.delivered")).toEqual({
      id: "evt-1",
      taskId: "task-3",
      kind: "delivery.delivered",
      at: 1,
      summary: "텔레그램 파일 전달 완료: /tmp/screenshot.png",
      attemptId: "run-delivered",
    })
    expect(failedTask?.activities.find((activity) => activity.kind === "delivery.failed")).toEqual({
      id: "evt-2",
      taskId: "task-4",
      kind: "delivery.failed",
      at: 1,
      summary: "텔레그램 응답 완료 신호 전달에 실패했습니다.",
      attemptId: "run-failed-delivery",
    })
    expect(deliveredTask?.checklist).toEqual({
      items: [
        { key: "request", status: "completed", summary: "스크린샷을 보냈습니다." },
        { key: "execution", status: "completed", summary: "스크린샷을 보냈습니다." },
        { key: "delivery", status: "completed", summary: "텔레그램 파일 전달 완료: /tmp/screenshot.png" },
        { key: "completion", status: "completed", summary: "스크린샷을 보냈습니다." },
      ],
      completedCount: 4,
      actionableCount: 4,
      failedCount: 0,
    })
    expect(failedTask?.checklist).toEqual({
      items: [
        { key: "request", status: "completed", summary: "텔레그램 전달이 실패했습니다." },
        { key: "execution", status: "completed", summary: "텔레그램 전달이 실패했습니다." },
        { key: "delivery", status: "failed", summary: "텔레그램 응답 완료 신호 전달에 실패했습니다." },
        { key: "completion", status: "failed", summary: "텔레그램 응답 완료 신호 전달에 실패했습니다." },
      ],
      completedCount: 2,
      actionableCount: 4,
      failedCount: 2,
    })
  })

  it("marks request confirmation separately while intake bridge is still running", () => {
    const task = buildTaskModels([
      makeRun({
        id: "run-intake",
        requestGroupId: "task-intake",
        prompt: "[Task Intake Bridge]\nTask: 메인 전체 화면 캡처",
        status: "running",
        summary: "요청을 해석하고 대상과 완료 조건을 정리하는 중입니다.",
      }),
    ])[0]

    expect(task?.checklist).toEqual({
      items: [
        { key: "request", status: "running", summary: "요청을 해석하고 대상과 완료 조건을 정리하는 중입니다." },
        { key: "execution", status: "pending" },
        { key: "delivery", status: "not_required" },
        { key: "completion", status: "running", summary: "요청을 해석하고 대상과 완료 조건을 정리하는 중입니다." },
      ],
      completedCount: 0,
      actionableCount: 3,
      failedCount: 0,
    })
  })

  it("surfaces structured execution failure details from the latest failed attempt", () => {
    const task = buildTaskModels([
      makeRun({
        id: "run-failed",
        requestGroupId: "task-7",
        prompt: "Generate the report",
        status: "failed",
        summary: "보고서 생성에 실패했습니다.",
        recentEvents: [
          { id: "evt-7-1", at: 10, label: "AI 호출 실패: 인증 또는 접근 차단 문제" },
          { id: "evt-7-2", at: 9, label: "AI 복구 재시도 한도(5회)에 도달했습니다." },
          { id: "evt-7-3", at: 8, label: "worker runtime를 기본 추론 경로로 대체합니다." },
        ],
      }),
    ])[0]

    expect(task?.failure).toEqual({
      kind: "execution",
      status: "failed",
      title: "실행 실패",
      summary: "AI 호출 실패: 인증 또는 접근 차단 문제",
      detailLines: [
        "AI 복구 재시도 한도(5회)에 도달했습니다.",
        "worker runtime를 기본 추론 경로로 대체합니다.",
      ],
      sourceAttemptId: "run-failed",
    })
  })

  it("treats a delivered task as completed even if only an internal attempt is still active", () => {
    const task = buildTaskModels([
      makeRun({
        id: "run-user",
        requestGroupId: "task-8",
        prompt: "지금 모니터 몇개야?",
        status: "completed",
        summary: "모니터 수를 확인했습니다.",
        createdAt: 1,
        updatedAt: 2,
      }),
      makeRun({
        id: "run-internal",
        requestGroupId: "task-8",
        prompt: "[Task Intake Bridge]\nTask: count monitors",
        status: "running",
        summary: "후속 실행으로 전달되었습니다.",
        createdAt: 3,
        updatedAt: 4,
        recentEvents: [{ id: "evt-8", at: 5, label: "텔레그램 파일 전달 완료: ~/monitor_status.txt" }],
      }),
    ])[0]

    expect(task?.status).toBe("completed")
    expect(task?.canCancel).toBe(false)
    expect(task?.delivery.status).toBe("delivered")
    expect(task?.checklist).toEqual({
      items: [
        { key: "request", status: "completed", summary: "후속 실행으로 전달되었습니다." },
        { key: "execution", status: "completed", summary: "모니터 수를 확인했습니다." },
        { key: "delivery", status: "completed", summary: "텔레그램 파일 전달 완료: ~/monitor_status.txt" },
        { key: "completion", status: "completed", summary: "후속 실행으로 전달되었습니다." },
      ],
      completedCount: 4,
      actionableCount: 4,
      failedCount: 0,
    })
  })

  it("publishes stable activity names and overlap signals for task monitoring", () => {
    const task = buildTaskModels([
      makeRun({
        id: "run-a",
        requestGroupId: "task-5",
        prompt: "Prepare report",
        status: "running",
        summary: "첫 실행 진행 중",
        createdAt: 1,
        updatedAt: 5,
      }),
      makeRun({
        id: "run-b",
        requestGroupId: "task-5",
        prompt: "[Approval Granted Continuation]\nTask: Prepare report",
        status: "awaiting_approval",
        summary: "승인 대기 중",
        createdAt: 2,
        updatedAt: 6,
      }),
    ])[0]

    expect(task?.activities.map((activity) => activity.kind)).toEqual([
      "attempt.awaiting_approval",
      "attempt.started",
      "attempt.started",
    ])
    expect(task?.monitor).toEqual({
      activeAttemptCount: 2,
      runningAttemptCount: 1,
      queuedAttemptCount: 0,
      visibleAttemptCount: 1,
      internalAttemptCount: 1,
      recoveryAttemptCount: 0,
      activeRecoveryCount: 0,
      duplicateExecutionRisk: true,
      awaitingApproval: true,
      awaitingUser: false,
      deliveryStatus: "not_requested",
    })
  })
})
