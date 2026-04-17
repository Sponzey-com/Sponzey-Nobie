import { displayHomePath } from "./delivery.js"
import type { AssistantTextDeliveryOutcome, DeliverySource } from "./delivery.js"
import { sanitizeUserFacingError } from "./error-sanitizer.js"
import type { SanitizedErrorKind } from "./error-sanitizer.js"

export interface FailedCommandTool {
  toolName: string
  output: string
  params?: unknown
}

export interface SuccessfulToolEvidence {
  toolName: string
  output: string
}

export type RecoveryAlternativeKind =
  | "other_tool"
  | "other_extension"
  | "other_channel"
  | "other_schedule"
  | "same_channel_retry"

export interface RecoveryAlternative {
  kind: RecoveryAlternativeKind
  label: string
}

interface RecoveryCandidateBase {
  key: string
  summary: string
  reason: string
  alternatives: RecoveryAlternative[]
}

export interface DeliveryRecoveryCandidate extends RecoveryCandidateBase {
  remainingItems: string[]
}

export interface CommandFailureRecoveryCandidate extends RecoveryCandidateBase {}

export interface GenericExecutionRecoveryCandidate extends RecoveryCandidateBase {}

export interface RecoveryKeyParts {
  action: string
  error: string
  toolName?: string | undefined
  targetId?: string | undefined
  channel?: DeliverySource | string | undefined
}

export function buildRecoveryKey(parts: RecoveryKeyParts): string {
  // nobie-critical-decision-audit: recovery.normalized_error_key
  // Recovery dedupe is based on structured tool/action/target/channel plus sanitized error kind, not user request text.
  const errorKind: SanitizedErrorKind = sanitizeUserFacingError(parts.error).kind
  return [
    "recovery",
    normalizeRecoveryKeyPart(parts.action || "unknown_action"),
    `target=${normalizeRecoveryKeyPart(parts.targetId ?? "none")}`,
    `channel=${normalizeRecoveryKeyPart(parts.channel ?? "none")}`,
    `tool=${normalizeRecoveryKeyPart(parts.toolName ?? "none")}`,
    `error=${normalizeRecoveryKeyPart(errorKind)}`,
  ].join("::")
}

function normalizeRecoveryKeyPart(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96)
  return normalized || "none"
}

export function isCommandFailureRecoveryTool(toolName: string): boolean {
  return toolName === "shell_exec" || toolName === "app_launch" || toolName === "process_kill"
}

function normalizeCommandFailureKey(toolName: string, output: string): string {
  return buildRecoveryKey({
    action: "command_failure",
    toolName,
    error: output,
  })
}

export function describeCommandFailureReason(output: string): string {
  // nobie-critical-decision-audit: recovery.command_failure_reason
  // Error-message classification only selects recovery candidates; it must not decide user intent or schedule identity.
  if (/(not found|command not found|enoent|is not recognized)/i.test(output)) {
    return "실행 명령을 찾지 못해 다른 명령이나 다른 도구 경로를 찾아야 합니다."
  }
  if (/(permission denied|operation not permitted|eacces|권한)/i.test(output)) {
    return "권한 또는 접근 제한 때문에 같은 방법으로는 실행할 수 없습니다."
  }
  if (/(no such file|cannot find|not a directory|경로|파일을 찾을 수 없음)/i.test(output)) {
    return "대상 경로나 파일 이름이 맞지 않아 다른 경로나 다른 생성 방법을 찾아야 합니다."
  }
  if (/(timeout|timed out|시간 초과)/i.test(output)) {
    return "시간 초과가 발생해 더 짧거나 다른 실행 방법을 찾아야 합니다."
  }
  return "이전 명령이 실패해서 다른 방법을 찾아 다시 시도해야 합니다."
}

export function selectCommandFailureRecovery(params: {
  failedTools: FailedCommandTool[]
  commandFailureSeen: boolean
  commandRecoveredWithinSamePass: boolean
  seenKeys: Set<string>
}): CommandFailureRecoveryCandidate | null {
  if (!params.commandFailureSeen || params.commandRecoveredWithinSamePass || params.failedTools.length === 0) {
    return null
  }

  for (let index = params.failedTools.length - 1; index >= 0; index -= 1) {
    const failedTool = params.failedTools[index]
    if (!failedTool) continue
    const key = normalizeCommandFailureKey(failedTool.toolName, failedTool.output)
    if (params.seenKeys.has(key)) continue

    return {
      key,
      summary: `${failedTool.toolName} 실패 후 다른 방법을 자동으로 찾는 중입니다.`,
      reason: describeCommandFailureReason(failedTool.output),
      alternatives: inferCommandFailureAlternatives(failedTool),
    }
  }

  return null
}

function normalizeExecutionRecoveryKey(toolNames: string[], reason: string): string {
  const normalizedTools = [...new Set(toolNames)].sort().join(",")
  return buildRecoveryKey({
    action: "execution_failure",
    toolName: normalizedTools || "none",
    error: reason,
  })
}

export function selectGenericExecutionRecovery(params: {
  executionRecovery: { summary: string; reason: string; toolNames: string[] }
  seenKeys: Set<string>
}): GenericExecutionRecoveryCandidate | null {
  if (params.executionRecovery.toolNames.length === 0) return null
  const key = normalizeExecutionRecoveryKey(params.executionRecovery.toolNames, params.executionRecovery.reason)
  if (params.seenKeys.has(key)) return null
  return {
    key,
    summary: params.executionRecovery.summary,
    reason: params.executionRecovery.reason,
    alternatives: inferGenericExecutionAlternatives(params.executionRecovery.toolNames),
  }
}

export function describeRecoveryAlternatives(alternatives: RecoveryAlternative[]): string | null {
  if (alternatives.length === 0) return null
  return `대안 후보: ${alternatives.map((alternative) => alternative.label).join(", ")}`
}

export function buildDirectArtifactDeliveryRecoveryPrompt(params: {
  originalRequest: string
  previousResult: string
  successfulTools: SuccessfulToolEvidence[]
  successfulFileDeliveries: Array<{ channel: string; filePath: string }>
  alternatives?: RecoveryAlternative[]
}): string {
  const toolLines = params.successfulTools
    .slice(-5)
    .map((tool, index) => `${index + 1}. ${tool.toolName}`)
  const deliveryLines = params.successfulFileDeliveries
    .slice(-3)
    .map((delivery, index) => `${index + 1}. ${delivery.channel}: ${displayHomePath(delivery.filePath)}`)
  const alternativeLines = params.alternatives?.map((alternative) => `- ${alternative.label}`) ?? []

  return [
    "[Direct Artifact Delivery Recovery]",
    "사용자는 결과물 자체를 보여주거나 보내달라고 요청했습니다.",
    `원래 사용자 요청: ${params.originalRequest}`,
    params.previousResult.trim() ? `이전 결과: ${params.previousResult.trim()}` : "",
    toolLines.length > 0 ? ["성공한 도구 실행:", ...toolLines].join("\n") : "",
    deliveryLines.length > 0 ? ["이미 전달된 파일:", ...deliveryLines].join("\n") : "",
    alternativeLines.length > 0 ? ["우선 검토할 대안:", ...alternativeLines].join("\n") : "",
    "설명, 권한 안내, 수동 해결 방법 제시만으로 완료 처리하지 마세요.",
    "결과물 자체를 실제로 전달하거나, 전달이 불가능하면 다른 실행 경로를 찾아 계속 진행하세요.",
    "전달 채널은 현재 사용자 요청이 들어온 채널로 고정하세요. 사용자가 Slack에서 요청했다면 Telegram 전달 도구를 쓰지 말고, Telegram 요청도 Slack 전달 경로로 바꾸지 마세요.",
    "도구 목록을 다시 확인하고, 적절한 Yeonjang 도구나 전달 도구를 우선 사용하세요.",
    "사용자가 요청한 결과물 자체가 실제로 전달되기 전에는 완료라고 말하지 마세요.",
    "최종 답변은 원래 사용자 요청과 같은 언어로 작성하세요.",
  ].filter(Boolean).join("\n\n")
}

export function selectDirectArtifactDeliveryRecovery(params: {
  source: DeliverySource
  successfulFileDeliveries: Array<{ channel: string; filePath: string }>
  seenKeys: Set<string>
}): DeliveryRecoveryCandidate | null {
  const deliveryFingerprint = params.successfulFileDeliveries
    .slice(-3)
    .map((delivery) => `${delivery.channel}:${displayHomePath(delivery.filePath)}`)
    .join("|")
  const key = buildRecoveryKey({
    action: "direct_artifact_delivery",
    channel: params.source,
    toolName: "artifact_delivery",
    error: deliveryFingerprint || "missing artifact delivery",
  })
  if (params.seenKeys.has(key)) return null

  return {
    key,
    summary: "메신저 결과 전달이 아직 끝나지 않아 다른 방법으로 계속 진행합니다.",
    reason: "설명이나 로컬 저장만으로는 완료가 아니며, 요청된 결과물 자체를 메신저로 전달해야 합니다.",
    alternatives: inferDirectArtifactDeliveryAlternatives(params.source),
    remainingItems: ["결과물 자체를 메신저로 실제 전달하는 단계가 남아 있습니다."],
  }
}

export function describeAssistantTextDeliveryFailure(params: {
  source: DeliverySource
  outcome: AssistantTextDeliveryOutcome
}): string {
  const channelLabel =
    params.source === "telegram"
      ? "텔레그램"
      : params.source === "webui"
        ? "WebUI"
        : params.source === "slack"
          ? "Slack"
        : "CLI"

  if (!params.outcome.hasDeliveryFailure) {
    return `${channelLabel} 응답 전달 완료`
  }

  switch (params.outcome.failureStage) {
    case "text_and_done":
      return `${channelLabel} 응답 텍스트와 완료 신호 전달에 실패했습니다.`
    case "text":
      return `${channelLabel} 응답 텍스트 전달에 실패했습니다.`
    case "done":
      return `${channelLabel} 응답 완료 신호 전달에 실패했습니다.`
    default:
      return `${channelLabel} 응답 전달 상태를 확인해야 합니다.`
  }
}

export function buildCommandFailureRecoveryPrompt(params: {
  originalRequest: string
  previousResult: string
  summary: string
  reason: string
  failedTools: FailedCommandTool[]
  alternatives?: RecoveryAlternative[]
}): string {
  const failedLines = params.failedTools.slice(-3).map((tool, index) => {
    const preview = tool.output.trim().replace(/\s+/g, " ").slice(0, 280)
    return `${index + 1}. ${tool.toolName} 실패: ${preview}`
  })
  const alternativeLines = params.alternatives?.map((alternative) => `- ${alternative.label}`) ?? []

  return [
    "[Command Failure Recovery]",
    "이전 시도에서 로컬 명령 실행이 실패했습니다.",
    `원래 사용자 요청: ${params.originalRequest}`,
    `복구 요약: ${params.summary}`,
    `실패 분석: ${params.reason}`,
    failedLines.length > 0 ? ["실패한 명령 기록:", ...failedLines].join("\n") : "",
    alternativeLines.length > 0 ? ["우선 검토할 대안:", ...alternativeLines].join("\n") : "",
    params.previousResult.trim() ? `이전 결과: ${params.previousResult.trim()}` : "",
    "실패 원인을 먼저 확인하고, 같은 실패 명령을 그대로 반복하지 마세요.",
    "경로, 권한, 명령 형식, 대상 프로그램 상태를 점검한 뒤 다른 연장 메서드, 다른 연장 대상, 파일 도구 같은 비명령 대안을 검토하세요.",
    "로컬 명령 fallback은 허용되지 않습니다.",
    "최종 답변은 원래 사용자 요청과 같은 언어로 작성하세요.",
  ].filter(Boolean).join("\n\n")
}

export function buildExecutionRecoveryPrompt(params: {
  originalRequest: string
  previousResult: string
  summary: string
  reason: string
  toolNames: string[]
  alternatives?: RecoveryAlternative[]
}): string {
  const toolLine = params.toolNames.length > 0
    ? `실패한 도구: ${[...new Set(params.toolNames)].join(", ")}`
    : ""
  const alternativeLines = params.alternatives?.map((alternative) => `- ${alternative.label}`) ?? []

  return [
    "[Execution Recovery]",
    "이전 시도에서 실행 도구가 실패했습니다.",
    `원래 사용자 요청: ${params.originalRequest}`,
    `복구 요약: ${params.summary}`,
    `실패 분석: ${params.reason}`,
    toolLine,
    alternativeLines.length > 0 ? ["우선 검토할 대안:", ...alternativeLines].join("\n") : "",
    params.previousResult.trim() ? `현재까지 결과: ${params.previousResult.trim()}` : "",
    "도구 목록을 다시 확인하고, 같은 실패 경로를 그대로 반복하지 마세요.",
    "Yeonjang 도구 또는 다른 연장 대상만 사용하고, 코어 로컬 fallback은 선택하지 마세요.",
    "도구의 가능 여부를 다시 확인한 뒤 남은 작업을 이어서 처리하세요.",
    "최종 답변은 원래 사용자 요청과 같은 언어로 작성하세요.",
  ].filter(Boolean).join("\n\n")
}

export function summarizeRawErrorForUser(message: string | undefined): string {
  return message?.trim() ? sanitizeUserFacingError(message).userMessage : ""
}

export function summarizeRawErrorActionHintForUser(message: string | undefined): string {
  return message?.trim() ? (sanitizeUserFacingError(message).actionHint ?? "") : ""
}

export function buildAiErrorRecoveryPrompt(params: {
  originalRequest: string
  previousResult: string
  summary: string
  reason: string
  message: string
  failedRoute?: string | undefined
  avoidTargets?: string[] | undefined
  nextRouteHint?: string | undefined
}): string {
  const avoidTargetLines = dedupeNonEmptyStrings(params.avoidTargets).map((target) => `- ${target}`)
  return [
    "[AI Error Recovery]",
    "이전 시도에서 모델 호출 중 오류가 발생했습니다.",
    `원래 사용자 요청: ${params.originalRequest}`,
    `복구 요약: ${params.summary}`,
    `오류 분석: ${params.reason}`,
    summarizeRawErrorForUser(params.message) ? `오류 세부: ${summarizeRawErrorForUser(params.message)}` : "",
    params.failedRoute?.trim() ? `실패한 접근 방식: ${params.failedRoute.trim()}` : "",
    avoidTargetLines.length > 0 ? ["다시 사용 금지 대상:", ...avoidTargetLines].join("\n") : "",
    params.nextRouteHint?.trim() ? `우선 검토할 다른 경로: ${params.nextRouteHint.trim()}` : "",
    params.previousResult.trim() ? `현재까지 결과: ${params.previousResult.trim()}` : "",
    "방금 실패한 접근을 그대로 반복하지 말고, 위에 적힌 금지 대상과 같은 방법은 다시 선택하지 마세요.",
    "같은 AI 연결과 같은 대상은 유지하고, provider/model 전환 없이 더 짧은 응답, 더 단순한 단계 분해, 다른 도구 조합 같은 전략만 바꾸세요.",
    "이미 성공한 작업은 유지하고, 남은 작업만 이어서 처리하세요.",
    "최종 답변은 원래 사용자 요청과 같은 언어로 작성하세요.",
  ].filter(Boolean).join("\n\n")
}

export function describeWorkerRuntimeErrorReason(message: string): string {
  if (/(exited with code 1|exit code 1|code 1)/i.test(message)) {
    return "작업 세션 프로세스가 오류 종료되어 같은 경로로는 진행할 수 없습니다."
  }
  if (/(not found|enoent|command not found)/i.test(message)) {
    return "작업 세션 실행 명령을 찾지 못했습니다."
  }
  if (/(permission denied|operation not permitted|eacces|권한)/i.test(message)) {
    return "작업 세션 실행 권한 또는 접근 제한 때문에 실패했습니다."
  }
  if (/(timeout|timed out|시간 초과)/i.test(message)) {
    return "작업 세션 응답이 시간 안에 끝나지 않았습니다."
  }
  return "작업 세션 경로에서 오류가 발생해 다른 경로나 다른 대상 전환이 필요합니다."
}

export function buildWorkerRuntimeErrorRecoveryPrompt(params: {
  originalRequest: string
  previousResult: string
  summary: string
  reason: string
  message: string
  failedRoute?: string | undefined
  avoidTargets?: string[] | undefined
  nextRouteHint?: string | undefined
}): string {
  const avoidTargetLines = dedupeNonEmptyStrings(params.avoidTargets).map((target) => `- ${target}`)
  return [
    "[Worker Runtime Error Recovery]",
    "이전 시도에서 외부 작업 세션 실행이 실패했습니다.",
    `원래 사용자 요청: ${params.originalRequest}`,
    `복구 요약: ${params.summary}`,
    `오류 분석: ${params.reason}`,
    summarizeRawErrorForUser(params.message) ? `오류 세부: ${summarizeRawErrorForUser(params.message)}` : "",
    params.failedRoute?.trim() ? `실패한 접근 방식: ${params.failedRoute.trim()}` : "",
    avoidTargetLines.length > 0 ? ["다시 사용 금지 대상:", ...avoidTargetLines].join("\n") : "",
    params.nextRouteHint?.trim() ? `우선 검토할 다른 경로: ${params.nextRouteHint.trim()}` : "",
    params.previousResult.trim() ? `현재까지 결과: ${params.previousResult.trim()}` : "",
    "같은 AI 연결과 같은 대상은 유지하고, 같은 작업 세션 경로를 그대로 반복하지 말고 위에 적힌 금지 대상과 같은 방법은 다시 선택하지 마세요.",
    "이미 성공한 작업은 유지하고, 남은 작업만 이어서 처리하세요.",
    "최종 답변은 원래 사용자 요청과 같은 언어로 작성하세요.",
  ].filter(Boolean).join("\n\n")
}

export function buildAiRecoveryAvoidTargets(
  targetId: string | undefined,
  workerRuntimeKind: string | undefined,
): string[] {
  return [targetId, workerRuntimeKind]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
}

export function buildAiRecoveryKey(params: {
  targetId: string | undefined
  workerRuntimeKind: string | undefined
  providerId: string | undefined
  model: string | undefined
  reason: string
  message: string
}): string {
  const route = params.workerRuntimeKind || params.targetId || params.providerId || params.model || "default"
  const fingerprint = normalizeAiRecoveryFingerprint(params.reason, params.message)
  const credentialPath = normalizeAiRecoveryCredentialPath(params.reason, params.message)
  return credentialPath === "auth=unknown"
    ? `${route}::${fingerprint}`
    : `${route}::${credentialPath}::${fingerprint}`
}

export function buildWorkerRuntimeRecoveryKey(params: {
  targetId: string | undefined
  workerRuntimeKind: string | undefined
  providerId: string | undefined
  model: string | undefined
  reason: string
  message: string
}): string {
  const route = params.workerRuntimeKind || params.targetId || params.providerId || params.model || "default"
  const fingerprint = normalizeAiRecoveryFingerprint(params.reason, params.message)
  return `worker::${route}::${fingerprint}`
}

function normalizeAiRecoveryFingerprint(reason: string, message: string): string {
  const combined = `${reason}\n${message}`
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, "<id>")
    .replace(/\b\d{3,}\b/g, "<num>")
    .replace(/\s+/g, " ")
    .trim()

  if (/timeout|timed out|etimedout|deadline/i.test(combined)) return "timeout"
  if (/rate limit|too many requests|429/i.test(combined)) return "rate-limit"
  if (/cloudflare|challenge|auth|unauthorized|forbidden|401|403|api key/i.test(combined)) return "auth"
  if (/context|token|too large|max context|maximum context/i.test(combined)) return "context-limit"
  if (/schema|parameter|unsupported|invalid_request|tool|function/i.test(combined)) return "request-schema"
  if (/network|socket|connect|connection|reset|refused|econn|dns|fetch failed/i.test(combined)) return "network"
  return combined.slice(0, 160)
}

function normalizeAiRecoveryCredentialPath(reason: string, message: string): string {
  const combined = `${reason}\n${message}`.toLowerCase()
  if (/(chatgpt|codex|oauth|auth\.json|refresh token|access token|토큰 갱신)/i.test(combined)) return "auth=chatgpt-oauth"
  if (/(api key|apikey|openai_api_key|x-api-key|bearer|sk-)/i.test(combined)) return "auth=api-key"
  return "auth=unknown"
}

function inferCommandFailureAlternatives(failedTool: FailedCommandTool): RecoveryAlternative[] {
  const alternatives: RecoveryAlternative[] = [{ kind: "other_tool", label: "다른 도구 경로 재시도" }]
  if (failedTool.toolName === "shell_exec" || failedTool.toolName === "app_launch" || failedTool.toolName === "process_kill") {
    alternatives.push({ kind: "other_extension", label: "다른 연장 또는 다른 실행 대상 검토" })
  }
  return alternatives
}

function inferGenericExecutionAlternatives(toolNames: string[]): RecoveryAlternative[] {
  const normalized = [...new Set(toolNames.map((toolName) => toolName.trim()).filter(Boolean))]
  const alternatives: RecoveryAlternative[] = []

  if (normalized.some((toolName) => isScheduleLikeToolName(toolName))) {
    alternatives.push({ kind: "other_schedule", label: "다른 일정 방식 또는 예약 구조 검토" })
  }
  if (normalized.some((toolName) => isExtensionPreferredToolName(toolName))) {
    alternatives.push({ kind: "other_extension", label: "다른 연장 또는 로컬 대체 경로 검토" })
  }
  alternatives.push({ kind: "other_tool", label: "다른 도구 조합 재시도" })

  return dedupeRecoveryAlternatives(alternatives)
}

function inferDirectArtifactDeliveryAlternatives(source: DeliverySource): RecoveryAlternative[] {
  const alternatives: RecoveryAlternative[] = [{ kind: "same_channel_retry", label: "같은 채널 재전송 시도" }]
  alternatives.push({ kind: "other_tool", label: "다른 전달 도구 또는 다른 실행 경로 검토" })
  return alternatives
}

function isExtensionPreferredToolName(toolName: string): boolean {
  return /^(screen_capture|mouse_|keyboard_|shell_exec|app_launch|process_kill|yeonjang_)/.test(toolName)
}

function isScheduleLikeToolName(toolName: string): boolean {
  return /schedule/i.test(toolName)
}

function dedupeRecoveryAlternatives(alternatives: RecoveryAlternative[]): RecoveryAlternative[] {
  const seen = new Set<string>()
  const result: RecoveryAlternative[] = []
  for (const alternative of alternatives) {
    const key = `${alternative.kind}:${alternative.label}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(alternative)
  }
  return result
}

function dedupeNonEmptyStrings(values: string[] | undefined): string[] {
  if (!values) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const normalized = value.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

export function hasMeaningfulRouteChange(params: {
  currentTargetId: string | undefined
  currentModel: string | undefined
  currentProviderId: string | undefined
  currentWorkerRuntimeKind: string | undefined
  nextTargetId: string | undefined
  nextModel: string | undefined
  nextProviderId: string | undefined
  nextWorkerRuntimeKind: string | undefined
}): boolean {
  return (params.currentWorkerRuntimeKind ?? "") !== (params.nextWorkerRuntimeKind ?? "")
    || (params.currentTargetId ?? "") !== (params.nextTargetId ?? "")
    || (params.currentProviderId ?? "") !== (params.nextProviderId ?? "")
    || (params.currentModel ?? "") !== (params.nextModel ?? "")
}

export function buildFilesystemMutationFollowupPrompt(params: {
  originalRequest: string
  previousResult: string
}): string {
  return [
    "[Filesystem Execution Required]",
    "원래 사용자 요청은 실제 로컬 파일 또는 폴더 변경이 필요합니다.",
    `원래 사용자 요청: ${params.originalRequest}`,
    params.previousResult.trim() ? `이전 불완전 결과: ${params.previousResult.trim()}` : "",
    "요청한 파일이나 폴더가 로컬 환경에서 실제로 생성되거나 수정되어야만 완료입니다.",
    "이제 사용 가능한 파일 또는 쉘 도구로 실제 로컬 작업을 수행하세요.",
    "수동 안내, 예시 코드만 제시하거나 실제 파일 변경 없이 완료했다고 말하지 마세요.",
    "최종 답변은 원래 사용자 요청과 같은 언어로 작성하세요.",
  ].filter(Boolean).join("\n\n")
}

export function buildFilesystemVerificationRecoveryPrompt(params: {
  originalRequest: string
  previousResult: string
  verificationSummary: string
  verificationReason?: string
  missingItems?: string[]
  mutationPaths?: string[]
}): string {
  const missing = params.missingItems?.filter((item) => item.trim()).map((item) => `- ${item}`) ?? []
  const targets = params.mutationPaths?.filter((item) => item.trim()).map((item) => `- ${displayHomePath(item)}`) ?? []

  return [
    "[Filesystem Verification Recovery]",
    "이전 시도에서 실제 파일 또는 폴더 결과를 자동 검증하지 못했습니다.",
    `원래 사용자 요청: ${params.originalRequest}`,
    `검증 요약: ${params.verificationSummary}`,
    params.verificationReason?.trim() ? `검증 사유: ${params.verificationReason.trim()}` : "",
    targets.length > 0 ? ["현재 확인 대상 경로:", ...targets].join("\n") : "",
    missing.length > 0 ? ["누락되었거나 다시 확인할 항목:", ...missing].join("\n") : "",
    params.previousResult.trim() ? `현재까지 결과: ${params.previousResult.trim()}` : "",
    "실제 파일 도구나 로컬 명령으로 경로 존재 여부를 직접 확인하세요.",
    "대상이 없으면 다른 방법으로 직접 생성하거나 수정하세요.",
    "이미 생성되었다면 실제 경로를 다시 찾아 검증 근거를 확보하세요.",
    "실제 존재 여부를 다시 확인하기 전에는 완료라고 말하지 마세요.",
    "최종 답변은 원래 사용자 요청과 같은 언어로 작성하세요.",
  ].filter(Boolean).join("\n\n")
}

export function buildEmptyResultRecoveryPrompt(params: {
  originalRequest: string
  previousResult: string
  successfulTools: SuccessfulToolEvidence[]
  sawRealFilesystemMutation: boolean
}): string {
  const successfulToolLines = params.successfulTools
    .slice(-3)
    .map((tool, index) => `${index + 1}. ${tool.toolName}`)

  return [
    "[Empty Result Recovery]",
    "이전 시도는 실행이 끝났지만 완료로 볼 수 있는 명확한 결과가 남지 않았습니다.",
    `원래 사용자 요청: ${params.originalRequest}`,
    params.previousResult.trim() ? `현재까지 텍스트 결과: ${params.previousResult.trim()}` : "",
    successfulToolLines.length > 0 ? ["성공한 도구 실행:", ...successfulToolLines].join("\n") : "",
    params.sawRealFilesystemMutation ? "실제 파일 또는 폴더 변경은 감지되었지만 사용자에게 전달할 명확한 결과 정리가 없습니다." : "",
    "이전 시도를 그대로 완료 처리하지 말고, 무엇이 실제로 완료되었는지 확인하세요.",
    "결과가 있다면 그 결과를 명확하게 정리해 전달하세요.",
    "결과가 부족하다면 남은 작업을 이어서 실제로 완료하세요.",
    "아무 일도 하지 않았는데 완료라고 말하지 마세요.",
    "최종 답변은 원래 사용자 요청과 같은 언어로 작성하세요.",
  ].filter(Boolean).join("\n\n")
}

export function shouldRetryTruncatedOutput(params: {
  review: {
    status: string
    summary?: string
    reason?: string
    userMessage?: string
    remainingItems?: string[]
  }
  preview: string
  requiresFilesystemMutation: boolean
}): boolean {
  if (params.review.status !== "ask_user") return false
  if (!params.requiresFilesystemMutation) return false

  const combined = [
    params.review.summary,
    params.review.reason,
    params.review.userMessage,
    ...(params.review.remainingItems ?? []),
    params.preview,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n")

  return /(중간[^\n]{0,20}(절단|중단)|절단 오류|코드[^\n]{0,20}(절단|중단)|미완성|incomplete|truncat|cut off|unfinished)/iu.test(combined)
}

export function buildTruncatedOutputRecoveryPrompt(params: {
  originalRequest: string
  previousResult: string
  summary?: string
  reason?: string
  remainingItems?: string[]
}): string {
  const remaining = params.remainingItems?.filter((item) => item.trim()).map((item) => `- ${item}`) ?? []
  return [
    "[Truncated Output Recovery]",
    "이전 시도에서 코드 또는 결과가 중간에 끊기거나 미완성으로 끝났습니다.",
    `원래 사용자 요청: ${params.originalRequest}`,
    params.summary?.trim() ? `검토 요약: ${params.summary.trim()}` : "",
    params.reason?.trim() ? `검토 사유: ${params.reason.trim()}` : "",
    remaining.length > 0 ? ["남은 항목:", ...remaining].join("\n") : "",
    params.previousResult.trim() ? `이전 불완전 결과:\n${params.previousResult.trim()}` : "",
    "지금 작업을 다시 시도하고 완전하게 끝내세요.",
    "파일을 써야 한다면 로컬 파일 또는 쉘 도구를 이용해 최종 파일을 실제로 생성하세요.",
    "부분 코드만 반복하지 말고, 파일 중간에서 끊기지 말고, 닫히지 않은 태그·함수·블록·문장으로 끝내지 마세요.",
    "사용자가 지정한 이름, 폴더명, 경로, 언어를 그대로 유지하고 번역하지 마세요.",
    "최종 답변은 원래 사용자 요청과 같은 언어로 작성하세요.",
  ].filter(Boolean).join("\n\n")
}
