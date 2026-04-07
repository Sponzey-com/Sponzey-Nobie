import {
  type TaskExecutionSemantics,
  type TaskIntentEnvelope,
  type TaskStructuredRequest,
} from "../agent/intake.js"
import { createRecoveryBudgetUsage, type RecoveryBudgetUsage } from "./recovery-budget.js"

export interface ResolvedExecutionProfile {
  originalRequest: string
  structuredRequest: TaskStructuredRequest
  intentEnvelope: TaskIntentEnvelope
  executionSemantics: TaskExecutionSemantics
  requiresFilesystemMutation: boolean
  requiresPrivilegedToolExecution: boolean
  wantsDirectArtifactDelivery: boolean
  approvalRequired: boolean
  approvalTool: string
}

export interface ExecutionLoopRuntimeState {
  executionProfile: ResolvedExecutionProfile
  originalUserRequest: string
  priorAssistantMessages: string[]
  seenFollowupPrompts: Set<string>
  seenCommandFailureRecoveryKeys: Set<string>
  seenExecutionRecoveryKeys: Set<string>
  seenDeliveryRecoveryKeys: Set<string>
  seenAiRecoveryKeys: Set<string>
  recoveryBudgetUsage: RecoveryBudgetUsage
  requiresFilesystemMutation: boolean
  requiresPrivilegedToolExecution: boolean
  pendingToolParams: Map<string, unknown>
  filesystemMutationPaths: Set<string>
}

export function buildResolvedExecutionProfile(params: {
  message: string
  originalRequest?: string
  executionSemantics?: TaskExecutionSemantics
  structuredRequest?: TaskStructuredRequest
  intentEnvelope?: TaskIntentEnvelope
}): ResolvedExecutionProfile {
  const executionSemantics = resolveExecutionSemantics(params)
  const structuredRequest =
    params.structuredRequest
    ?? (params.intentEnvelope ? buildStructuredRequestFromEnvelope(params.intentEnvelope) : undefined)
    ?? buildFallbackStructuredRequest(params.originalRequest?.trim() || params.message)
  const intentEnvelope = repairIntentEnvelope({
    intentEnvelope: params.intentEnvelope,
    structuredRequest,
    executionSemantics,
  })
  return {
    originalRequest: params.originalRequest?.trim() || params.message,
    structuredRequest,
    intentEnvelope,
    executionSemantics,
    requiresFilesystemMutation: executionSemantics.filesystemEffect === "mutate",
    requiresPrivilegedToolExecution: executionSemantics.privilegedOperation === "required",
    wantsDirectArtifactDelivery: executionSemantics.artifactDelivery === "direct",
    approvalRequired: executionSemantics.approvalRequired,
    approvalTool: executionSemantics.approvalTool,
  }
}

export function createExecutionLoopRuntimeState(params: {
  message: string
  originalRequest?: string
  executionSemantics?: TaskExecutionSemantics
  structuredRequest?: TaskStructuredRequest
  intentEnvelope?: TaskIntentEnvelope
}): ExecutionLoopRuntimeState {
  const executionProfile = buildResolvedExecutionProfile(params)
  return {
    executionProfile,
    originalUserRequest: executionProfile.originalRequest,
    priorAssistantMessages: [],
    seenFollowupPrompts: new Set<string>(),
    seenCommandFailureRecoveryKeys: new Set<string>(),
    seenExecutionRecoveryKeys: new Set<string>(),
    seenDeliveryRecoveryKeys: new Set<string>(),
    seenAiRecoveryKeys: new Set<string>(),
    recoveryBudgetUsage: createRecoveryBudgetUsage(),
    requiresFilesystemMutation: executionProfile.requiresFilesystemMutation,
    requiresPrivilegedToolExecution: executionProfile.requiresPrivilegedToolExecution,
    pendingToolParams: new Map<string, unknown>(),
    filesystemMutationPaths: new Set<string>(),
  }
}

function buildFallbackStructuredRequest(message: string): TaskStructuredRequest {
  const normalized = message.trim()
  const sourceLanguage = /[가-힣]/u.test(normalized)
    ? /[A-Za-z]/.test(normalized) ? "mixed" : "ko"
    : /[A-Za-z]/.test(normalized) ? "en" : "unknown"

  return {
    ...buildDefaultTaskStructuredRequest(),
    source_language: sourceLanguage,
    normalized_english: normalized,
    target: normalized || "Execute the requested work.",
    to: "the current channel",
    context: normalized ? [`Original user request: ${normalized}`] : [],
    complete_condition: ["The requested work is completed and the result is delivered in the current channel."],
  }
}

function buildDefaultTaskExecutionSemantics(): TaskExecutionSemantics {
  return {
    filesystemEffect: "none",
    privilegedOperation: "none",
    artifactDelivery: "none",
    approvalRequired: false,
    approvalTool: "external_action",
  }
}

function buildDefaultTaskStructuredRequest(): TaskStructuredRequest {
  return {
    source_language: "unknown",
    normalized_english: "",
    target: "",
    to: "",
    context: [],
    complete_condition: [],
  }
}

function buildStructuredRequestFromEnvelope(envelope: TaskIntentEnvelope): TaskStructuredRequest {
  return {
    source_language: envelope.source_language,
    normalized_english: envelope.normalized_english,
    target: envelope.target,
    to: envelope.destination,
    context: [...envelope.context],
    complete_condition: [...envelope.complete_condition],
  }
}

function buildFallbackIntentEnvelope(
  structuredRequest: TaskStructuredRequest,
  executionSemantics: TaskExecutionSemantics,
): TaskIntentEnvelope {
  return {
    intent_type: "task_intake",
    source_language: structuredRequest.source_language,
    normalized_english: structuredRequest.normalized_english,
    target: structuredRequest.target,
    destination: structuredRequest.to,
    context: [...structuredRequest.context],
    complete_condition: [...structuredRequest.complete_condition],
    schedule_spec: {
      detected: false,
      kind: "none",
      status: "not_applicable",
      schedule_text: "",
    },
    execution_semantics: executionSemantics,
    delivery_mode: executionSemantics.artifactDelivery,
    requires_approval: executionSemantics.approvalRequired,
    approval_tool: executionSemantics.approvalTool,
    preferred_target: "auto",
    needs_tools: executionSemantics.filesystemEffect === "mutate" || executionSemantics.privilegedOperation === "required",
    needs_web: false,
  }
}

function resolveExecutionSemantics(params: {
  message: string
  originalRequest?: string
  executionSemantics?: TaskExecutionSemantics
  structuredRequest?: TaskStructuredRequest
  intentEnvelope?: TaskIntentEnvelope
}): TaskExecutionSemantics {
  const base = params.executionSemantics ?? buildDefaultTaskExecutionSemantics()
  const shouldUseDirectArtifactDelivery = shouldTreatAsDirectArtifactDelivery(params, base)

  if (base.artifactDelivery === "direct" && !shouldUseDirectArtifactDelivery) {
    return {
      ...base,
      artifactDelivery: "none",
    }
  }

  if (base.artifactDelivery === "direct") return base
  if (!shouldUseDirectArtifactDelivery) return base
  return {
    ...base,
    artifactDelivery: "direct",
  }
}

function repairIntentEnvelope(params: {
  intentEnvelope: TaskIntentEnvelope | undefined
  structuredRequest: TaskStructuredRequest
  executionSemantics: TaskExecutionSemantics
}): TaskIntentEnvelope {
  if (!params.intentEnvelope) {
    return buildFallbackIntentEnvelope(params.structuredRequest, params.executionSemantics)
  }

  return {
    ...params.intentEnvelope,
    execution_semantics: params.executionSemantics,
    delivery_mode: params.executionSemantics.artifactDelivery,
  }
}

function shouldTreatAsDirectArtifactDelivery(
  params: {
    message: string
    originalRequest?: string
    structuredRequest?: TaskStructuredRequest
    intentEnvelope?: TaskIntentEnvelope
  },
  executionSemantics: TaskExecutionSemantics,
): boolean {
  if (executionSemantics.approvalTool === "screen_capture" || executionSemantics.approvalTool === "yeonjang_camera_capture") {
    return true
  }

  const combined = [
    params.message,
    params.originalRequest,
    params.structuredRequest?.target,
    params.structuredRequest?.normalized_english,
    params.intentEnvelope?.target,
    params.intentEnvelope?.normalized_english,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n")

  if (!combined) return false

  const normalized = combined.trim()
  if (!normalized) return false

  const referencesExplicitArtifactFile = /\.(pdf|png|jpe?g|webp|csv|json|txt|docx|xlsx)\b/iu.test(normalized)
  const referencesArtifactImage = /(screen\s*capture|screenshot|screen shot|camera\s*capture|take\s+(?:a\s+)?photo|take\s+(?:a\s+)?picture)/iu.test(normalized)
    || /(화면\s*캡처|스크린\s*캡처|스크린샷|캡쳐|카메라\s*(?:캡처|촬영)|사진\s*촬영)/u.test(combined)
  const referencesArtifactDelivery = (
    /\b(file|document|attachment|report|image|artifact)\b/iu.test(normalized)
    && /\b(send|deliver|attach|return|export|show)\b/iu.test(normalized)
  ) || (
    /(?:파일|문서|첨부|보고서|이미지)/u.test(normalized)
    && /(?:보내|전달|첨부|반환|내보내|보여)/u.test(normalized)
  )

  return referencesExplicitArtifactFile || referencesArtifactImage || referencesArtifactDelivery
}
