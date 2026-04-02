import type { LLMProvider } from "../llm/index.js"
import { resolveRunRoute, type ResolvedRunRoute } from "./routing.js"
import {
  buildLlmErrorRecoveryPrompt,
  buildLlmRecoveryAvoidTargets,
  buildLlmRecoveryKey,
  buildWorkerRuntimeErrorRecoveryPrompt,
  buildWorkerRuntimeRecoveryKey,
  hasMeaningfulRouteChange,
} from "./recovery.js"
import type { TaskProfile } from "./types.js"
import type { WorkerRuntimeTarget } from "./worker-runtime.js"

export type ExternalRecoveryKind = "llm" | "worker_runtime"

export interface ExternalRecoveryPayload {
  summary: string
  reason: string
  message: string
}

export interface ExternalRecoveryState {
  model: string | undefined
  providerId: string | undefined
  provider: LLMProvider | undefined
  targetId: string | undefined
  targetLabel: string | undefined
  workerRuntime: WorkerRuntimeTarget | undefined
}

export interface ExternalRecoveryPlan {
  recoveryKey: string
  eventLabel: string
  routeChanged: boolean
  routeEventLabel?: string
  nextState: ExternalRecoveryState
  nextMessage: string
  duplicateStop?: {
    summary: string
    reason: string
    remainingItems: string[]
  }
}

interface ExternalRecoveryDependencies {
  resolveRoute: (params: {
    taskProfile: TaskProfile
    fallbackModel?: string
    avoidTargets?: string[]
  }) => ResolvedRunRoute
}

const defaultDependencies: ExternalRecoveryDependencies = {
  resolveRoute: resolveRunRoute,
}

export function planExternalRecovery(params: {
  kind: ExternalRecoveryKind
  taskProfile: TaskProfile
  current: ExternalRecoveryState
  payload: ExternalRecoveryPayload
  seenKeys: Set<string>
  originalRequest: string
  previousResult: string
  dependencies?: Partial<ExternalRecoveryDependencies>
}): ExternalRecoveryPlan {
  const dependencies = { ...defaultDependencies, ...params.dependencies }
  const recoveryKey = params.kind === "llm"
    ? buildLlmRecoveryKey({
        targetId: params.current.targetId,
        workerRuntimeKind: params.current.workerRuntime?.kind,
        providerId: params.current.providerId,
        model: params.current.model,
        reason: params.payload.reason,
        message: params.payload.message,
      })
    : buildWorkerRuntimeRecoveryKey({
        targetId: params.current.targetId,
        workerRuntimeKind: params.current.workerRuntime?.kind,
        providerId: params.current.providerId,
        model: params.current.model,
        reason: params.payload.reason,
        message: params.payload.message,
      })

  const reroute = dependencies.resolveRoute({
    taskProfile: params.taskProfile,
    ...(params.current.model ? { fallbackModel: params.current.model } : {}),
    avoidTargets: buildLlmRecoveryAvoidTargets(params.current.targetId, params.current.workerRuntime?.kind),
  })

  const routeChanged = hasMeaningfulRouteChange({
    currentTargetId: params.current.targetId,
    currentModel: params.current.model,
    currentProviderId: params.current.providerId,
    currentWorkerRuntimeKind: params.current.workerRuntime?.kind,
    nextTargetId: reroute.targetId,
    nextModel: reroute.model ?? params.current.model,
    nextProviderId: reroute.providerId ?? params.current.providerId,
    nextWorkerRuntimeKind: reroute.workerRuntime?.kind,
  })

  if (!routeChanged && params.seenKeys.has(recoveryKey)) {
    return {
      recoveryKey,
      eventLabel: params.kind === "llm"
        ? "LLM 오류를 분석하고 다른 방법으로 재시도합니다."
        : "작업 세션 오류를 분석하고 다른 방법으로 재시도합니다.",
      routeChanged: false,
      nextState: params.current,
      nextMessage: "",
      duplicateStop: params.kind === "llm"
        ? {
            summary: "같은 LLM 오류가 같은 대상에서 반복되어 자동 진행을 멈췄습니다.",
            reason: params.payload.reason,
            remainingItems: ["같은 실행 대상과 같은 모델에서 동일한 LLM 오류가 반복되어 다른 수동 조치가 필요합니다."],
          }
        : {
            summary: "같은 작업 세션 오류가 같은 대상에서 반복되어 자동 진행을 멈췄습니다.",
            reason: params.payload.reason,
            remainingItems: ["같은 작업 세션에서 동일한 오류가 반복되어 다른 수동 조치가 필요합니다."],
          },
    }
  }

  const nextState: ExternalRecoveryState = {
    model: params.current.model,
    providerId: params.current.providerId,
    provider: params.current.provider,
    targetId: params.current.targetId,
    targetLabel: params.current.targetLabel,
    workerRuntime: params.current.workerRuntime,
  }

  let routeEventLabel: string | undefined
  if (routeChanged) {
    routeEventLabel = reroute.targetLabel
      ? `${params.kind === "llm" ? "LLM" : "작업 세션"} 복구 경로 전환: ${describeCurrentTarget(params.current)} -> ${reroute.targetLabel}`
      : `${params.kind === "llm" ? "LLM" : "작업 세션"} 복구를 위해 다른 실행 경로로 전환합니다.`
    nextState.model = reroute.model ?? nextState.model
    nextState.providerId = reroute.providerId ?? nextState.providerId
    nextState.provider = reroute.provider
    nextState.targetId = reroute.targetId ?? nextState.targetId
    nextState.targetLabel = reroute.targetLabel ?? reroute.targetId ?? nextState.targetLabel
    nextState.workerRuntime = reroute.workerRuntime
  } else if (params.current.workerRuntime) {
    routeEventLabel = `${params.current.workerRuntime.label} 경로 대신 기본 추론 경로로 전환합니다.`
    nextState.workerRuntime = undefined
    nextState.provider = undefined
  }

  return {
    recoveryKey,
    eventLabel: params.kind === "llm"
      ? "LLM 오류를 분석하고 다른 방법으로 재시도합니다."
      : "작업 세션 오류를 분석하고 다른 방법으로 재시도합니다.",
    routeChanged,
    ...(routeEventLabel ? { routeEventLabel } : {}),
    nextState,
    nextMessage: params.kind === "llm"
      ? buildLlmErrorRecoveryPrompt({
          originalRequest: params.originalRequest,
          previousResult: params.previousResult,
          summary: params.payload.summary,
          reason: params.payload.reason,
          message: params.payload.message,
        })
      : buildWorkerRuntimeErrorRecoveryPrompt({
          originalRequest: params.originalRequest,
          previousResult: params.previousResult,
          summary: params.payload.summary,
          reason: params.payload.reason,
          message: params.payload.message,
        }),
  }
}

function describeCurrentTarget(state: ExternalRecoveryState): string {
  return state.targetLabel ?? state.targetId ?? state.model ?? "현재 대상"
}
