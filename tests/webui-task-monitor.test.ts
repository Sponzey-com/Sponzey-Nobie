import { describe, expect, it } from "vitest"
import { buildTaskMonitorCards, describeTaskDeliveryStatus, filterActiveTaskMonitorCards } from "../packages/webui/src/lib/task-monitor.js"
import type { RootRun } from "../packages/webui/src/contracts/runs.js"
import type { TaskModel } from "../packages/webui/src/contracts/tasks.js"

const text = (ko: string, _en: string) => ko

function makeRun(overrides: Partial<RootRun> & Pick<RootRun, "id" | "requestGroupId" | "prompt">): RootRun {
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
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    steps: overrides.steps ?? [],
    recentEvents: overrides.recentEvents ?? [],
    ...(overrides.targetId ? { targetId: overrides.targetId } : {}),
    ...(overrides.targetLabel ? { targetLabel: overrides.targetLabel } : {}),
    ...(overrides.workerRuntimeKind ? { workerRuntimeKind: overrides.workerRuntimeKind } : {}),
    ...(overrides.workerSessionId ? { workerSessionId: overrides.workerSessionId } : {}),
  }
}

function makeTask(overrides: Partial<TaskModel> & Pick<TaskModel, "id" | "requestGroupId" | "anchorRunId">): TaskModel {
  const deliveryChecklistStatus =
    overrides.delivery?.status === "failed"
      ? "failed"
      : overrides.delivery?.status === "delivered"
        ? "completed"
        : "not_required"
  const completionChecklistStatus =
    overrides.failure?.status === "failed"
      ? "failed"
      : overrides.failure?.status === "cancelled" || overrides.failure?.status === "interrupted"
        ? "cancelled"
        : overrides.status === "completed"
          ? "completed"
          : "running"
  const defaultChecklistItems = [
    { key: "request" as const, status: "completed" as const, summary: overrides.requestText ?? "Original request" },
    { key: "execution" as const, status: overrides.status === "completed" ? "completed" as const : "running" as const, summary: overrides.summary ?? "Task summary" },
    { key: "delivery" as const, status: deliveryChecklistStatus },
    { key: "completion" as const, status: completionChecklistStatus, summary: overrides.summary ?? "Task summary" },
  ]
  const actionableChecklistItems = defaultChecklistItems.filter((item) => item.status !== "not_required")

  return {
    id: overrides.id,
    requestGroupId: overrides.requestGroupId,
    sessionId: overrides.sessionId ?? "session-1",
    source: overrides.source ?? "telegram",
    anchorRunId: overrides.anchorRunId,
    latestAttemptId: overrides.latestAttemptId ?? overrides.anchorRunId,
    runIds: overrides.runIds ?? [overrides.anchorRunId],
    title: overrides.title ?? "Task title",
    requestText: overrides.requestText ?? "Original request",
    summary: overrides.summary ?? "Task summary",
    status: overrides.status ?? "running",
    canCancel: overrides.canCancel ?? true,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    attempts: overrides.attempts ?? [],
    recoveryAttempts: overrides.recoveryAttempts ?? [],
    delivery: overrides.delivery ?? { taskId: overrides.id, status: "not_requested" },
    ...(overrides.failure ? { failure: overrides.failure } : {}),
    checklist: overrides.checklist ?? {
      items: defaultChecklistItems,
      completedCount: actionableChecklistItems.filter((item) => item.status === "completed").length,
      actionableCount: actionableChecklistItems.length,
      failedCount: actionableChecklistItems.filter((item) => item.status === "failed" || item.status === "cancelled").length,
    },
    monitor: overrides.monitor ?? {
      activeAttemptCount: 1,
      runningAttemptCount: 1,
      queuedAttemptCount: 0,
      visibleAttemptCount: 1,
      internalAttemptCount: 0,
      recoveryAttemptCount: 0,
      activeRecoveryCount: 0,
      duplicateExecutionRisk: false,
      awaitingApproval: false,
      awaitingUser: false,
      deliveryStatus: "not_requested",
    },
    activities: overrides.activities ?? [],
  }
}

describe("webui task monitor helper", () => {
  it("builds one card from a task projection and hides internal attempts from the default tree", () => {
    const cards = buildTaskMonitorCards([
      makeTask({
        id: "task-1",
        requestGroupId: "task-1",
        anchorRunId: "run-root",
        attempts: [
          {
            id: "run-root",
            taskId: "task-1",
            requestGroupId: "task-1",
            kind: "primary",
            title: "Take a screenshot",
            prompt: "Take a screenshot",
            status: "running",
            summary: "첫 실행",
            userVisible: true,
            createdAt: 1,
            updatedAt: 2,
          },
          {
            id: "run-verify",
            taskId: "task-1",
            requestGroupId: "task-1",
            kind: "verification",
            title: "Verification",
            prompt: "[Filesystem Verification]",
            status: "completed",
            summary: "검증 중",
            userVisible: false,
            createdAt: 3,
            updatedAt: 4,
          },
          {
            id: "run-followup",
            taskId: "task-1",
            requestGroupId: "task-1",
            kind: "followup",
            title: "Retry",
            prompt: "Take a screenshot again",
            status: "running",
            summary: "후속 실행",
            userVisible: true,
            createdAt: 5,
            updatedAt: 6,
          },
        ],
        latestAttemptId: "run-followup",
        runIds: ["run-root", "run-verify", "run-followup"],
        monitor: {
          activeAttemptCount: 2,
          runningAttemptCount: 2,
          queuedAttemptCount: 0,
          visibleAttemptCount: 2,
          internalAttemptCount: 1,
          recoveryAttemptCount: 0,
          activeRecoveryCount: 0,
          duplicateExecutionRisk: true,
          awaitingApproval: false,
          awaitingUser: false,
          deliveryStatus: "not_requested",
        },
      }),
    ], [
      makeRun({ id: "run-root", requestGroupId: "task-1", prompt: "Take a screenshot", summary: "첫 실행", createdAt: 1, updatedAt: 2 }),
      makeRun({ id: "run-verify", requestGroupId: "task-1", prompt: "[Filesystem Verification]", summary: "검증 중", status: "completed", createdAt: 3, updatedAt: 4 }),
      makeRun({ id: "run-followup", requestGroupId: "task-1", prompt: "Take a screenshot again", summary: "후속 실행", createdAt: 5, updatedAt: 6 }),
    ], text)

    expect(cards).toHaveLength(1)
    expect(cards[0]?.attempts).toHaveLength(3)
    expect(cards[0]?.internalAttempts.map((attempt) => attempt.id)).toEqual(["run-verify"])
    expect(cards[0]?.treeNodes.map((node) => node.id)).toEqual(["run-root", "run-followup"])
    expect(cards[0]?.duplicateExecutionRisk).toBe(true)
    expect(cards[0]?.checklist.items.map((item) => item.label)).toEqual([
      "요청 확인",
      "실행",
      "전달",
      "완료 확인",
    ])
    expect(cards[0]?.checklist.completedCount).toBe(1)
  })

  it("tracks delivery separately from task status", () => {
    const cards = buildTaskMonitorCards([
      makeTask({
        id: "task-2",
        requestGroupId: "task-2",
        anchorRunId: "run-delivery",
        status: "completed",
        delivery: {
          taskId: "task-2",
          status: "delivered",
          sourceAttemptId: "run-delivery",
          channel: "telegram",
          summary: "텔레그램 파일 전달 완료: /tmp/file.txt",
        },
        monitor: {
          activeAttemptCount: 0,
          runningAttemptCount: 0,
          queuedAttemptCount: 0,
          visibleAttemptCount: 1,
          internalAttemptCount: 0,
          recoveryAttemptCount: 0,
          activeRecoveryCount: 0,
          duplicateExecutionRisk: false,
          awaitingApproval: false,
          awaitingUser: false,
          deliveryStatus: "delivered",
        },
        attempts: [
          {
            id: "run-delivery",
            taskId: "task-2",
            requestGroupId: "task-2",
            kind: "primary",
            title: "Send the file",
            prompt: "Send the file",
            status: "completed",
            summary: "파일을 보냈습니다.",
            userVisible: true,
            createdAt: 1,
            updatedAt: 2,
          },
        ],
        latestAttemptId: "run-delivery",
        runIds: ["run-delivery"],
        activities: [
          {
            id: "evt-1",
            taskId: "task-2",
            kind: "delivery.delivered",
            at: 3,
            summary: "텔레그램 파일 전달 완료: /tmp/file.txt",
            attemptId: "run-delivery",
          },
        ],
      }),
    ], [
      makeRun({
        id: "run-delivery",
        requestGroupId: "task-2",
        prompt: "Send the file",
        status: "completed",
        summary: "파일을 보냈습니다.",
        createdAt: 1,
        updatedAt: 2,
      }),
    ], text)

    expect(cards[0]?.representative.status).toBe("completed")
    expect(cards[0]?.delivery.status).toBe("delivered")
    expect(cards[0]?.timeline[0]?.runLabel).toBe("사용자 요청")
    expect(describeTaskDeliveryStatus(cards[0]!.delivery.status, text)).toBe("전달 완료")
    expect(cards[0]?.checklist.completedCount).toBe(4)
  })

  it("keeps recovery attempts internal while the task stays visible", () => {
    const cards = buildTaskMonitorCards([
      makeTask({
        id: "task-5",
        requestGroupId: "task-5",
        anchorRunId: "run-root",
        attempts: [
          {
            id: "run-root",
            taskId: "task-5",
            requestGroupId: "task-5",
            kind: "primary",
            title: "Create the report",
            prompt: "Create the report",
            status: "running",
            summary: "첫 실행",
            userVisible: true,
            createdAt: 1,
            updatedAt: 2,
          },
          {
            id: "run-recovery",
            taskId: "task-5",
            requestGroupId: "task-5",
            kind: "filesystem_retry",
            title: "Filesystem retry",
            prompt: "[Filesystem Execution Required]\nTask: Create the report",
            status: "running",
            summary: "실제 파일 작업 재시도 중",
            userVisible: false,
            createdAt: 3,
            updatedAt: 4,
          },
        ],
        latestAttemptId: "run-recovery",
        runIds: ["run-root", "run-recovery"],
        recoveryAttempts: [
          {
            id: "run-recovery",
            taskId: "task-5",
            sourceAttemptId: "run-root",
            kind: "filesystem",
            status: "running",
            summary: "실제 파일 작업 재시도 중",
            userVisible: false,
            createdAt: 3,
            updatedAt: 4,
          },
        ],
        monitor: {
          activeAttemptCount: 2,
          runningAttemptCount: 2,
          queuedAttemptCount: 0,
          visibleAttemptCount: 1,
          internalAttemptCount: 1,
          recoveryAttemptCount: 1,
          activeRecoveryCount: 1,
          duplicateExecutionRisk: true,
          awaitingApproval: false,
          awaitingUser: false,
          deliveryStatus: "not_requested",
        },
      }),
    ], [
      makeRun({ id: "run-root", requestGroupId: "task-5", prompt: "Create the report", summary: "첫 실행", createdAt: 1, updatedAt: 2 }),
      makeRun({ id: "run-recovery", requestGroupId: "task-5", prompt: "[Filesystem Execution Required]", summary: "실제 파일 작업 재시도 중", createdAt: 3, updatedAt: 4 }),
    ], text)

    expect(cards[0]?.internalAttempts.map((attempt) => attempt.kind)).toEqual(["filesystem_retry"])
    expect(cards[0]?.treeNodes.map((node) => node.id)).toEqual(["run-root"])
    expect(filterActiveTaskMonitorCards(cards).map((card) => card.key)).toEqual(["task-5"])
  })

  it("tracks failed delivery separately from task completion", () => {
    const cards = buildTaskMonitorCards([
      makeTask({
        id: "task-6",
        requestGroupId: "task-6",
        anchorRunId: "run-delivery-failed",
        status: "completed",
        failure: {
          kind: "delivery",
          status: "failed",
          title: "전달 실패",
          summary: "텔레그램 응답 전달 실패: timeout",
          detailLines: ["텔레그램 세션이 연결되어 있지 않습니다."],
          sourceAttemptId: "run-delivery-failed",
        },
        delivery: {
          taskId: "task-6",
          status: "failed",
          sourceAttemptId: "run-delivery-failed",
          channel: "telegram",
          summary: "텔레그램 응답 전달 실패: timeout",
        },
        monitor: {
          activeAttemptCount: 0,
          runningAttemptCount: 0,
          queuedAttemptCount: 0,
          visibleAttemptCount: 1,
          internalAttemptCount: 0,
          recoveryAttemptCount: 0,
          activeRecoveryCount: 0,
          duplicateExecutionRisk: false,
          awaitingApproval: false,
          awaitingUser: false,
          deliveryStatus: "failed",
        },
        attempts: [
          {
            id: "run-delivery-failed",
            taskId: "task-6",
            requestGroupId: "task-6",
            kind: "primary",
            title: "Send the summary",
            prompt: "Send the summary",
            status: "completed",
            summary: "전달 단계에서 실패했습니다.",
            userVisible: true,
            createdAt: 1,
            updatedAt: 2,
          },
        ],
        latestAttemptId: "run-delivery-failed",
        runIds: ["run-delivery-failed"],
        activities: [
          {
            id: "evt-2",
            taskId: "task-6",
            kind: "delivery.failed",
            at: 3,
            summary: "텔레그램 응답 전달 실패: timeout",
            attemptId: "run-delivery-failed",
          },
        ],
      }),
    ], [
      makeRun({
        id: "run-delivery-failed",
        requestGroupId: "task-6",
        prompt: "Send the summary",
        status: "completed",
        summary: "전달 단계에서 실패했습니다.",
        createdAt: 1,
        updatedAt: 2,
      }),
    ], text)

    expect(cards[0]?.representative.status).toBe("completed")
    expect(cards[0]?.delivery.status).toBe("failed")
    expect(cards[0]?.failure).toEqual({
      kind: "delivery",
      status: "failed",
      title: "전달 실패",
      summary: "텔레그램 응답 전달 실패: timeout",
      detailLines: ["텔레그램 세션이 연결되어 있지 않습니다."],
      sourceAttemptId: "run-delivery-failed",
      sourceAttemptLabel: "사용자 요청",
    })
    expect(describeTaskDeliveryStatus(cards[0]!.delivery.status, text)).toBe("전달 실패")
  })

  it("filters only active task cards for queue views", () => {
    const cards = buildTaskMonitorCards([
      makeTask({
        id: "task-3",
        requestGroupId: "task-3",
        anchorRunId: "run-active",
        status: "running",
        attempts: [
          {
            id: "run-active",
            taskId: "task-3",
            requestGroupId: "task-3",
            kind: "primary",
            title: "Active task",
            prompt: "Active task",
            status: "running",
            summary: "active",
            userVisible: true,
            createdAt: 1,
            updatedAt: 2,
          },
        ],
        latestAttemptId: "run-active",
        runIds: ["run-active"],
      }),
      makeTask({
        id: "task-4",
        requestGroupId: "task-4",
        anchorRunId: "run-done",
        status: "completed",
        attempts: [
          {
            id: "run-done",
            taskId: "task-4",
            requestGroupId: "task-4",
            kind: "primary",
            title: "Done task",
            prompt: "Done task",
            status: "completed",
            summary: "done",
            userVisible: true,
            createdAt: 1,
            updatedAt: 2,
          },
        ],
        latestAttemptId: "run-done",
        runIds: ["run-done"],
        monitor: {
          activeAttemptCount: 0,
          runningAttemptCount: 0,
          queuedAttemptCount: 0,
          visibleAttemptCount: 1,
          internalAttemptCount: 0,
          recoveryAttemptCount: 0,
          activeRecoveryCount: 0,
          duplicateExecutionRisk: false,
          awaitingApproval: false,
          awaitingUser: false,
          deliveryStatus: "not_requested",
        },
      }),
    ], [
      makeRun({ id: "run-active", requestGroupId: "task-3", prompt: "Active task", status: "running" }),
      makeRun({ id: "run-done", requestGroupId: "task-4", prompt: "Done task", status: "completed" }),
    ], text)

    expect(filterActiveTaskMonitorCards(cards).map((card) => card.key)).toEqual(["task-3"])
  })

  it("uses explicit task run ids instead of regrouping raw runs by request group", () => {
    const cards = buildTaskMonitorCards([
      makeTask({
        id: "task-7",
        requestGroupId: "shared-group",
        anchorRunId: "run-owned",
        latestAttemptId: "run-owned",
        runIds: ["run-owned"],
        attempts: [
          {
            id: "run-owned",
            taskId: "task-7",
            requestGroupId: "shared-group",
            kind: "primary",
            title: "Owned run",
            prompt: "Owned run",
            status: "running",
            summary: "실제 태스크 run",
            userVisible: true,
            createdAt: 1,
            updatedAt: 2,
          },
        ],
      }),
    ], [
      makeRun({ id: "run-owned", requestGroupId: "shared-group", prompt: "Owned run", summary: "실제 태스크 run", createdAt: 1, updatedAt: 2 }),
      makeRun({ id: "run-leaked", requestGroupId: "shared-group", prompt: "Leaked run", summary: "구형 heuristic이면 섞이던 run", createdAt: 3, updatedAt: 4 }),
    ], text)

    expect(cards[0]?.runs.map((run) => run.id)).toEqual(["run-owned"])
    expect(cards[0]?.attempts[0]?.prompt).toBe("Owned run")
  })

  it("keeps a task card visible even when the raw runs list no longer contains its representative run", () => {
    const cards = buildTaskMonitorCards([
      makeTask({
        id: "task-8",
        requestGroupId: "task-8",
        anchorRunId: "run-missing",
        latestAttemptId: "run-missing",
        runIds: ["run-missing"],
        status: "completed",
        canCancel: false,
        requestText: "오래된 태스크",
        summary: "projection만 남은 태스크",
        attempts: [
          {
            id: "run-missing",
            taskId: "task-8",
            requestGroupId: "task-8",
            kind: "primary",
            title: "오래된 태스크",
            prompt: "오래된 태스크",
            status: "completed",
            summary: "projection만 남은 태스크",
            userVisible: true,
            createdAt: 1,
            updatedAt: 2,
          },
        ],
      }),
    ], [], text)

    expect(cards).toHaveLength(1)
    expect(cards[0]?.representative.id).toBe("run-missing")
    expect(cards[0]?.representative.status).toBe("completed")
    expect(cards[0]?.representative.prompt).toBe("오래된 태스크")
  })
})
