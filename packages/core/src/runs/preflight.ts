import type { AIProvider } from "../ai/index.js"
import { detectAvailableProvider, getDefaultModel } from "../ai/index.js"
import { getSlackRuntimeStatus } from "../channels/slack/runtime.js"
import { getTelegramRuntimeStatus } from "../channels/telegram/runtime.js"
import { getMqttExtensionSnapshots } from "../mqtt/broker.js"
import type { TaskExecutionSemantics } from "../agent/intake.js"
import type { RunChunkDeliveryHandler } from "./delivery.js"
import type { FinalizationSource } from "./finalization.js"
import type { WorkerRuntimeTarget } from "./worker-runtime.js"

export interface StartPreflightFailure {
  code:
    | "ai_connection_unavailable"
    | "ai_model_unavailable"
    | "channel_unavailable"
    | "yeonjang_unavailable"
  summary: string
  userMessage: string
  eventLabel: string
}

export interface StartPreflightInput {
  source: FinalizationSource
  message: string
  model?: string | undefined
  providerId?: string | undefined
  provider?: AIProvider | undefined
  onChunk?: RunChunkDeliveryHandler
  immediateCompletionText?: string | undefined
  toolsEnabled?: boolean | undefined
  executionSemantics?: TaskExecutionSemantics | undefined
  targetId?: string | undefined
  workerRuntime?: WorkerRuntimeTarget | undefined
}

const YEONJANG_APPROVAL_TOOL_PATTERN =
  /^(screen_capture|screen_find_text|mouse_|keyboard_|shell_exec|app_launch|process_kill|window_|yeonjang_)/u

function normalize(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? ""
}

function hasExplicitAiRoute(input: StartPreflightInput): boolean {
  return Boolean(input.provider || input.providerId?.trim())
}

function requiresAiRoute(input: StartPreflightInput): boolean {
  return !input.immediateCompletionText?.trim()
}

function requiresChannelRuntime(input: StartPreflightInput): boolean {
  return input.source === "telegram" || input.source === "slack"
}

function requiresYeonjangRuntime(input: StartPreflightInput): boolean {
  if (input.toolsEnabled === false) return false
  const approvalTool = input.executionSemantics?.approvalTool?.trim()
  if (approvalTool && YEONJANG_APPROVAL_TOOL_PATTERN.test(approvalTool)) return true

  const targetText = [
    input.targetId,
    input.workerRuntime?.kind,
    input.workerRuntime?.label,
  ].filter(Boolean).join(" ").toLowerCase()
  return targetText.includes("yeonjang")
}

function hasConnectedYeonjangSnapshot(): boolean {
  return getMqttExtensionSnapshots().some((snapshot) => normalize(snapshot.state) !== "offline")
}

function resolveChannelFailure(input: StartPreflightInput): StartPreflightFailure | null {
  if (!requiresChannelRuntime(input)) return null

  const status = input.source === "telegram"
    ? getTelegramRuntimeStatus()
    : getSlackRuntimeStatus()
  if (status.isRunning && input.onChunk) return null

  const label = input.source === "telegram" ? "Telegram" : "Slack"
  const reason = status.lastError?.trim()
    ? ` 최근 오류: ${status.lastError.trim()}`
    : ""

  return {
    code: "channel_unavailable",
    summary: `${label} 채널이 실행 중이 아니어서 요청을 전달할 수 없습니다.`,
    userMessage: `${label} 채널 런타임이 실행 중이 아니어서 요청을 시작할 수 없습니다.${reason}\n설정에서 채널 연결 상태를 확인한 뒤 다시 요청해 주세요.`,
    eventLabel: `preflight_failed: channel_unavailable:${input.source}`,
  }
}

function resolveAiFailure(input: StartPreflightInput): StartPreflightFailure | null {
  if (!requiresAiRoute(input)) return null

  if (!hasExplicitAiRoute(input) && !detectAvailableProvider()) {
    return {
      code: "ai_connection_unavailable",
      summary: "사용 가능한 AI 연결이 없어 요청을 시작할 수 없습니다.",
      userMessage: "사용 가능한 AI 연결이 없습니다. 설정에서 AI 연결과 기본 모델을 저장한 뒤 다시 요청해 주세요.",
      eventLabel: "preflight_failed: ai_connection_unavailable",
    }
  }

  if (!input.model?.trim() && !getDefaultModel()) {
    return {
      code: "ai_model_unavailable",
      summary: "기본 모델이 설정되어 있지 않아 요청을 시작할 수 없습니다.",
      userMessage: "AI 연결은 있지만 기본 모델이 설정되어 있지 않습니다. 설정에서 기본 모델을 저장한 뒤 다시 요청해 주세요.",
      eventLabel: "preflight_failed: ai_model_unavailable",
    }
  }

  return null
}

function resolveYeonjangFailure(input: StartPreflightInput): StartPreflightFailure | null {
  if (!requiresYeonjangRuntime(input)) return null
  if (hasConnectedYeonjangSnapshot()) return null

  return {
    code: "yeonjang_unavailable",
    summary: "연장이 연결되어 있지 않아 로컬 실행 요청을 시작할 수 없습니다.",
    userMessage: "연장(Yeonjang)이 연결되어 있지 않아 화면/키보드/쉘 같은 로컬 실행 요청을 시작할 수 없습니다.\n연장을 실행해 MQTT에 연결한 뒤 다시 요청해 주세요.",
    eventLabel: "preflight_failed: yeonjang_unavailable",
  }
}

export function resolveStartPreflightFailure(input: StartPreflightInput): StartPreflightFailure | null {
  return resolveChannelFailure(input)
    ?? resolveAiFailure(input)
    ?? resolveYeonjangFailure(input)
}
