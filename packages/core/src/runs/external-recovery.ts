import type { AIProvider } from "../ai/index.js"
import { resolveRunRoute, type ResolvedRunRoute } from "./routing.js"
import {
  buildAiErrorRecoveryPrompt,
  buildAiRecoveryAvoidTargets,
  buildAiRecoveryKey,
  buildWorkerRuntimeErrorRecoveryPrompt,
  buildWorkerRuntimeRecoveryKey,
  hasMeaningfulRouteChange,
} from "./recovery.js"
import type { TaskProfile } from "./types.js"
import type { WorkerRuntimeTarget } from "./worker-runtime.js"

export type ExternalRecoveryKind = "ai" | "worker_runtime"

export interface ExternalRecoveryPayload {
  summary: string
  reason: string
  message: string
}

export interface ExternalRecoveryState {
  model: string | undefined
  providerId: string | undefined
  provider: AIProvider | undefined
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
    rawMessage?: string
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
  const recoveryKey = params.kind === "ai"
    ? buildAiRecoveryKey({
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
    avoidTargets: buildAiRecoveryAvoidTargets(params.current.targetId, params.current.workerRuntime?.kind),
  })
  const avoidTargets = buildAiRecoveryAvoidTargets(params.current.targetId, params.current.workerRuntime?.kind)

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
      eventLabel: params.kind === "ai"
        ? "AI 오류를 분석하고 다른 방법으로 재시도합니다."
        : "작업 세션 오류를 분석하고 다른 방법으로 재시도합니다.",
      routeChanged: false,
      nextState: params.current,
      nextMessage: "",
      duplicateStop: params.kind === "ai"
        ? {
            summary: "같은 AI 오류가 같은 대상에서 반복되어 자동 진행을 멈췄습니다.",
            reason: params.payload.reason,
            ...(params.payload.message.trim() ? { rawMessage: params.payload.message } : {}),
            remainingItems: ["같은 실행 대상과 같은 AI 경로에서 동일한 오류가 반복되어 다른 수동 조치가 필요합니다."],
          }
        : {
            summary: "같은 작업 세션 오류가 같은 대상에서 반복되어 자동 진행을 멈췄습니다.",
            reason: params.payload.reason,
            ...(params.payload.message.trim() ? { rawMessage: params.payload.message } : {}),
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
      ? `${params.kind === "ai" ? "AI" : "작업 세션"} 복구 경로 전환: ${describeCurrentTarget(params.current)} -> ${reroute.targetLabel}`
      : `${params.kind === "ai" ? "AI" : "작업 세션"} 복구를 위해 다른 실행 경로로 전환합니다.`
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
    eventLabel: params.kind === "ai"
      ? "AI 오류를 분석하고 다른 방법으로 재시도합니다."
      : "작업 세션 오류를 분석하고 다른 방법으로 재시도합니다.",
    routeChanged,
    ...(routeEventLabel ? { routeEventLabel } : {}),
    nextState,
    nextMessage: params.kind === "ai"
      ? buildAiErrorRecoveryPrompt({
          originalRequest: params.originalRequest,
          previousResult: params.previousResult,
          summary: params.payload.summary,
          reason: params.payload.reason,
          message: params.payload.message,
          failedRoute: describeCurrentAttempt(params.current),
          avoidTargets,
          ...(describeRecoveryNextRoute(routeChanged, reroute, params.current)
            ? { nextRouteHint: describeRecoveryNextRoute(routeChanged, reroute, params.current) }
            : {}),
        })
      : buildWorkerRuntimeErrorRecoveryPrompt({
          originalRequest: params.originalRequest,
          previousResult: params.previousResult,
          summary: params.payload.summary,
          reason: params.payload.reason,
          message: params.payload.message,
          failedRoute: describeCurrentAttempt(params.current),
          avoidTargets,
          ...(describeRecoveryNextRoute(routeChanged, reroute, params.current)
            ? { nextRouteHint: describeRecoveryNextRoute(routeChanged, reroute, params.current) }
            : {}),
        }),
  }
}

function describeCurrentTarget(state: ExternalRecoveryState): string {
  return state.targetLabel ?? state.targetId ?? state.model ?? "현재 대상"
}

function describeCurrentAttempt(state: ExternalRecoveryState): string {
  if (state.workerRuntime) {
    const details = [state.workerRuntime.label]
    if (state.targetLabel && state.targetLabel !== state.workerRuntime.label) details.push(state.targetLabel)
    if (state.model) details.push(state.model)
    return details.join(" / ")
  }

  const details = [state.targetLabel ?? state.targetId ?? "기본 AI 경로"]
  if (state.providerId) details.push(state.providerId)
  if (state.model) details.push(state.model)
  return details.join(" / ")
}

function describeRecoveryNextRoute(
  routeChanged: boolean,
  reroute: ResolvedRunRoute,
  current: ExternalRecoveryState,
): string | undefined {
  if (routeChanged) {
    return reroute.targetLabel ?? reroute.targetId ?? reroute.model ?? reroute.providerId ?? "다른 실행 경로"
  }

  if (current.workerRuntime) {
    return "기본 AI 추론 경로"
  }

  return undefined
}
