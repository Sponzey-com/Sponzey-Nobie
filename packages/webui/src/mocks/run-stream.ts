import type { RootRun, RunEvent, RunStep, TaskProfile } from "../contracts/runs"

export type DemoRunScenario = "default" | "approval" | "failure"

interface RunMutation {
  updateRun: (runId: string, updater: (run: RootRun) => RootRun) => void
}

const STEP_TITLES = [
  { key: "received", title: "요청 수신" },
  { key: "classified", title: "요청 분석" },
  { key: "target_selected", title: "대상 선택" },
  { key: "executing", title: "실행" },
  { key: "reviewing", title: "결과 검토" },
  { key: "awaiting_approval", title: "승인 대기" },
  { key: "awaiting_user", title: "사용자 대기" },
  { key: "finalizing", title: "마무리" },
  { key: "completed", title: "완료" },
] as const

const timers = new Map<string, number[]>()

function now() {
  return Date.now()
}

function newEvent(label: string): RunEvent {
  return { id: crypto.randomUUID(), at: now(), label }
}

function baseSteps(): RunStep[] {
  return STEP_TITLES.map((step, index) => ({
    key: step.key,
    title: step.title,
    index: index + 1,
    status: index === 0 ? "running" : "pending",
    startedAt: index === 0 ? now() : undefined,
    summary: index === 0 ? "사용자 요청을 로컬 mock 런타임이 수신했습니다." : "",
  }))
}

export function createHistoricalRuns(): RootRun[] {
  const createdAt = now() - 1000 * 60 * 40
  const finishedAt = now() - 1000 * 60 * 25
  const completedSteps = STEP_TITLES.map((step, index) => ({
    key: step.key,
    title: step.title,
    index: index + 1,
    status: "completed" as const,
    startedAt: createdAt + index * 1000,
    finishedAt: createdAt + (index + 1) * 1000,
    summary: `${step.title} 단계를 완료했습니다.`,
  }))

  const cancelledSteps = completedSteps.map((step) => ({ ...step }))
  cancelledSteps[3] = {
    ...cancelledSteps[3],
    status: "cancelled",
    summary: "실행 중 사용자가 취소했습니다.",
  }

  return [
    {
      id: crypto.randomUUID(),
      title: "완료된 데모 태스크",
      prompt: "대시보드와 실행 상태 UI 확인",
      source: "webui",
      status: "completed",
      taskProfile: "planning",
      targetId: "provider:gemini",
      delegationTurnCount: 2,
      maxDelegationTurns: 5,
      currentStepKey: "completed",
      currentStepIndex: 9,
      totalSteps: 9,
      summary: "모든 단계를 마치고 완료된 실행 예시입니다.",
      canCancel: false,
      createdAt,
      updatedAt: finishedAt,
      steps: completedSteps,
      recentEvents: [
        newEvent("요청 분석 완료"),
        newEvent("Gemini 대상 선택"),
        newEvent("결과 검토 완료"),
      ],
    },
    {
      id: crypto.randomUUID(),
      title: "취소된 데모 태스크",
      prompt: "취소 흐름 확인",
      source: "webui",
      status: "cancelled",
      taskProfile: "operations",
      targetId: "worker:claude_code",
      delegationTurnCount: 1,
      maxDelegationTurns: 5,
      currentStepKey: "executing",
      currentStepIndex: 4,
      totalSteps: 9,
      summary: "실행 중 사용자 취소로 중단된 예시입니다.",
      canCancel: false,
      createdAt: createdAt + 5000,
      updatedAt: finishedAt + 5000,
      steps: cancelledSteps,
      recentEvents: [
        newEvent("Claude Code 대상 선택"),
        newEvent("실행 단계 진입"),
        newEvent("사용자 취소 요청"),
      ],
    },
  ]
}

export function createDemoRun(scenario: DemoRunScenario, prompt?: string): RootRun {
  const taskProfile: TaskProfile = scenario === "failure" ? "review" : "coding"
  const targetId = scenario === "failure" ? "provider:openai" : "worker:claude_code"
  return {
    id: crypto.randomUUID(),
    title:
      scenario === "approval"
        ? "승인 대기 데모 태스크"
        : scenario === "failure"
          ? "실패 데모 태스크"
          : "기본 데모 태스크",
    prompt: prompt ?? "Phase 0001 UI 검증용 데모 실행",
    source: "webui",
    status: "queued",
    taskProfile,
    targetId,
    delegationTurnCount: 1,
    maxDelegationTurns: 5,
    currentStepKey: "received",
    currentStepIndex: 1,
    totalSteps: STEP_TITLES.length,
    summary: "실행 요청이 큐에 등록되었습니다.",
    canCancel: true,
    createdAt: now(),
    updatedAt: now(),
    steps: baseSteps().map((step, index) =>
      index === 0 ? { ...step, status: "pending", startedAt: undefined, summary: "" } : step,
    ),
    recentEvents: [newEvent("데모 태스크가 생성되었습니다.")],
  }
}

function recordEvent(run: RootRun, label: string): RootRun {
  const event = newEvent(label)
  return {
    ...run,
    updatedAt: event.at,
    recentEvents: [event, ...run.recentEvents].slice(0, 6),
  }
}

function updateCurrentStep(run: RootRun, stepKey: string, status: RootRun["status"], summary: string): RootRun {
  const stepIndex = run.steps.findIndex((step) => step.key === stepKey)
  if (stepIndex === -1) return run
  const steps = run.steps.map((step, index) => {
    if (index < stepIndex) {
      return step.status === "completed" ? step : { ...step, status: "completed", finishedAt: now() }
    }
    if (index === stepIndex) {
      return {
        ...step,
        status:
          status === "failed"
            ? "failed"
            : status === "cancelled"
              ? "cancelled"
              : status === "completed"
                ? "completed"
                : "running",
        startedAt: step.startedAt ?? now(),
        finishedAt: status === "running" || status === "awaiting_approval" || status === "awaiting_user" ? undefined : now(),
        summary,
      }
    }
    return step
  })
  return {
    ...run,
    status,
    currentStepKey: stepKey,
    currentStepIndex: stepIndex + 1,
    summary,
    steps,
    updatedAt: now(),
  }
}

export function attachDemoRunStream(run: RootRun, scenario: DemoRunScenario, mutations: RunMutation): void {
  const queue: number[] = []
  const schedule = (delayMs: number, callback: () => void) => {
    const id = window.setTimeout(callback, delayMs)
    queue.push(id)
  }

  const update = (updater: (current: RootRun) => RootRun) => {
    mutations.updateRun(run.id, updater)
  }

  update((current) => recordEvent(current, "큐에 등록되었습니다."))

  schedule(500, () => {
    update((current) =>
      recordEvent(
        updateCurrentStep(current, "received", "running", "요청을 수신하고 실행 준비를 시작했습니다."),
        "요청 수신 완료",
      ),
    )
  })

  schedule(1500, () => {
    update((current) => {
      const next = updateCurrentStep(current, "classified", "running", "요청을 coding 작업으로 분류했습니다.")
      return recordEvent(next, "요청 분석 완료")
    })
  })

  schedule(2600, () => {
    update((current) => {
      const next = {
        ...updateCurrentStep(current, "target_selected", "running", "Claude Code 세션을 기본 실행 대상으로 선택했습니다."),
        delegationTurnCount: Math.min(current.delegationTurnCount + 1, current.maxDelegationTurns),
      }
      return recordEvent(next, "실행 대상 선택 완료")
    })
  })

  schedule(3800, () => {
    update((current) => recordEvent(updateCurrentStep(current, "executing", "running", "현재 로컬 mock 런타임에서 작업을 진행 중입니다."), "실행 단계 진입"))
  })

  if (scenario === "approval") {
    schedule(5200, () => {
      update((current) =>
        recordEvent(
          updateCurrentStep(current, "awaiting_approval", "awaiting_approval", "위험 도구 실행 전 사용자 승인을 기다리고 있습니다."),
          "승인 요청 생성",
        ),
      )
    })
  } else if (scenario === "failure") {
    schedule(5200, () => {
      update((current) => recordEvent(updateCurrentStep(current, "reviewing", "running", "중간 결과를 검토하고 있습니다."), "검토 단계 진입"))
    })
    schedule(7000, () => {
      update((current) =>
        recordEvent(
          {
            ...updateCurrentStep(current, "reviewing", "failed", "실행은 완료되었지만 검토 결과 요구사항을 만족하지 못했습니다."),
            canCancel: false,
          },
          "실패로 종료",
        ),
      )
      clearTimers(run.id)
    })
  } else {
    schedule(5200, () => {
      update((current) => {
        const next = {
          ...updateCurrentStep(current, "reviewing", "running", "중간 결과를 검토하고 다음 행동을 결정하고 있습니다."),
          delegationTurnCount: Math.min(current.delegationTurnCount + 1, current.maxDelegationTurns),
        }
        return recordEvent(next, "결과 검토 진행 중")
      })
    })
    schedule(6800, () => {
      update((current) => recordEvent(updateCurrentStep(current, "finalizing", "running", "최종 응답과 요약을 정리하는 중입니다."), "응답 정리 중"))
    })
    schedule(8400, () => {
      update((current) =>
        recordEvent(
          {
            ...updateCurrentStep(current, "completed", "completed", "데모 실행이 완료되었습니다. 모든 상태와 요약이 저장되었습니다."),
            canCancel: false,
          },
          "실행 완료",
        ),
      )
      clearTimers(run.id)
    })
  }

  timers.set(run.id, queue)
}

export function cancelDemoRun(runId: string, mutations: RunMutation): void {
  clearTimers(runId)
  mutations.updateRun(runId, (current) =>
    recordEvent(
      {
        ...updateCurrentStep(current, current.currentStepKey, "cancelled", "사용자가 실행을 취소했습니다."),
        canCancel: false,
      },
      "취소 요청 처리 완료",
    ),
  )
}

function clearTimers(runId: string) {
  const queue = timers.get(runId) ?? []
  for (const id of queue) window.clearTimeout(id)
  timers.delete(runId)
}
