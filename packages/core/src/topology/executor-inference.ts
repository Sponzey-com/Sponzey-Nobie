import type { EnterpriseTimestamp } from "../contracts/enterprise-topology.js"
import {
  normalizeExecutorProfile,
  type ExecutorProfile,
} from "./executor-profile.js"
import type {
  ExecutorConnectionDraft,
  ExecutorAdvancedMapping,
  ExecutorDraft,
  ExecutorInferenceEvidence,
  ExecutorRuntimeMode,
} from "./executor-graph.js"
import {
  buildNodeTaskAnalysis,
  type NodeTaskAnalysis,
  type NodeTaskAnalysisSource,
} from "./executor-task-analysis.js"

export const EXECUTOR_UNDERSTANDING_VERSION = "executor-understanding:v1" as const
export const EXECUTOR_UNDERSTANDING_DRAFT_VERSION = "executor-understanding:draft" as const

export interface ExecutorInferenceInput {
  name: string
  description: string
  executorProfile?: ExecutorProfile
}

export interface ExecutorInferenceKeywordHit {
  keyword: string
  hint:
    | "crm"
    | "approval"
    | "review"
    | "external"
    | "exception"
    | "report"
    | "research"
    | "tool"
}

export interface ExecutorInferenceResult {
  runtimeMode: ExecutorRuntimeMode
  executorProfile: ExecutorProfile
  toolHints: string[]
  outputHints: string[]
  successCriteria: string[]
  capabilityHints: string[]
  summaryKo: string
  summaryEn: string
  confidence: number
  keywordHits: ExecutorInferenceKeywordHit[]
  requiresClarification: boolean
  readyForAutoRun: boolean
}

export interface CreateExecutorDraftFromInferenceOptions extends ExecutorInferenceInput {
  id?: string
  sourceNodeId?: string
  now?: EnterpriseTimestamp
  userConfirmed?: boolean
}

export interface InferExecutorTaskAnalysisOptions {
  executor: ExecutorDraft
  incomingConnections?: ExecutorConnectionDraft[]
  outgoingConnections?: ExecutorConnectionDraft[]
  now?: EnterpriseTimestamp
  source?: NodeTaskAnalysisSource
}

export function inferExecutorFromDescription(input: ExecutorInferenceInput): ExecutorInferenceResult {
  const name = input.name.trim()
  const description = input.description.trim()
  const executorProfile = normalizeExecutorProfile(input.executorProfile, {
    executorId: "executor:draft",
    displayName: name || "실행자",
    roleName: input.executorProfile?.roleName ?? "executor",
    definition: description || name || "업무를 처리한다.",
    does: description ? [description] : [],
    delegationScope: input.executorProfile?.delegationScope ?? [],
    expectedOutputs: input.executorProfile?.expectedOutputs ?? [],
    handoffStyle: input.executorProfile?.handoffStyle ?? "structured_handoff",
    declineCriteria: input.executorProfile?.declineCriteria ?? [],
    riskBoundary: input.executorProfile?.riskBoundary ?? [],
  })
  const runtimeMode = runtimeModeFromProfile(input.executorProfile)
  const toolHints: string[] = []
  const capabilityHints = profileCapabilities(executorProfile)
  const outputHints = profileOutputs(executorProfile)
  const successCriteria = profileSuccessCriteria(executorProfile)
  const confidence = inferConfidence({
    description,
    hasStoredProfile: Boolean(input.executorProfile),
    profileDetailCount: profileDetailCount(executorProfile),
    runtimeMode,
  })
  const requiresClarification = !input.executorProfile && (confidence < 0.58 || description.length === 0)

  return {
    runtimeMode,
    executorProfile,
    toolHints,
    outputHints,
    successCriteria,
    capabilityHints,
    summaryKo: buildKoreanSummary({ name, description, runtimeMode, toolHints, outputHints }),
    summaryEn: buildEnglishSummary({ name, description, runtimeMode, toolHints, outputHints }),
    confidence,
    keywordHits: [],
    requiresClarification,
    readyForAutoRun: Boolean(input.executorProfile) && runtimeMode !== "unknown" && confidence >= 0.58,
  }
}

export function createExecutorDraftFromInference(
  options: CreateExecutorDraftFromInferenceOptions,
): ExecutorDraft {
  const id = options.id?.trim() || executorIdFromName(options.name, options.now)
  const inference = inferExecutorFromDescription(options)
  const confirmed = options.userConfirmed === true
  const evidence = buildExecutorInferenceEvidence({
    executorId: id,
    name: options.name.trim(),
    description: options.description.trim(),
    inference,
    confirmed,
    ...(options.sourceNodeId ? { sourceNodeId: options.sourceNodeId } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  })
  return {
    id,
    name: options.name.trim(),
    description: options.description.trim(),
    inferredRuntimeMode: inference.runtimeMode,
    inferredCapabilities: inference.capabilityHints,
    inferredTools: inference.toolHints,
    inferredOutputs: inference.outputHints,
    inferredSuccessCriteria: inference.successCriteria,
    executorProfile: normalizeExecutorProfile(inference.executorProfile, {
      executorId: id,
      displayName: options.name.trim() || id,
      roleName: inference.executorProfile.roleName,
      definition: inference.executorProfile.definition,
      does: inference.executorProfile.does,
      delegationScope: inference.executorProfile.delegationScope,
      expectedOutputs: inference.executorProfile.expectedOutputs,
      handoffStyle: inference.executorProfile.handoffStyle,
      declineCriteria: inference.executorProfile.declineCriteria,
      riskBoundary: inference.executorProfile.riskBoundary,
    }),
    confidence: inference.confidence,
    ...(confirmed ? { userConfirmed: true, confirmedUnderstandingVersion: EXECUTOR_UNDERSTANDING_VERSION } : {}),
    ...(options.sourceNodeId ? { sourceNodeId: options.sourceNodeId } : {}),
    inferenceEvidence: evidence,
    advancedMapping: {
      nodeType: nodeTypeForRuntimeMode(inference.runtimeMode),
      executorKind: executorKindForRuntimeMode(inference.runtimeMode),
      allowedToolIds: [],
      allowedSystemIds: [],
    },
  }
}

export function inferExecutorTaskAnalysis(options: InferExecutorTaskAnalysisOptions): NodeTaskAnalysis {
  return buildNodeTaskAnalysis({
    executor: options.executor,
    ...(options.incomingConnections ? { incomingConnections: options.incomingConnections } : {}),
    ...(options.outgoingConnections ? { outgoingConnections: options.outgoingConnections } : {}),
    ...(options.source ? { source: options.source } : {}),
    ...(options.now !== undefined ? { now: normalizeAnalysisTimestamp(options.now) } : {}),
  })
}

export function confirmExecutorUnderstanding(
  executor: ExecutorDraft,
  version = EXECUTOR_UNDERSTANDING_VERSION,
): ExecutorDraft {
  const inferenceEvidence = executor.inferenceEvidence
    ? {
      ...executor.inferenceEvidence,
      understandingState: "confirmed" as const,
      confirmedUnderstandingVersion: version,
    }
    : undefined
  return {
    ...executor,
    userConfirmed: true,
    confirmedUnderstandingVersion: version,
    ...(inferenceEvidence ? { inferenceEvidence } : {}),
  }
}

export function buildExecutorInferenceEvidence(input: {
  executorId: string
  sourceNodeId?: string
  name: string
  description: string
  inference: ExecutorInferenceResult
  confirmed?: boolean
  now?: EnterpriseTimestamp
}): ExecutorInferenceEvidence {
  const ruleIds = [
    `runtime:${input.inference.runtimeMode}`,
    `profile:${normalizeRuleKeyword(input.inference.executorProfile.roleName)}`,
    ...input.inference.toolHints.map((toolId) => `tool:${toolId}`),
    ...input.inference.outputHints.map((output) => `output:${normalizeRuleKeyword(output)}`),
  ]
  const confirmed = input.confirmed === true
  return {
    schemaVersion: 1,
    evidenceId: `executor-inference:${input.executorId}`,
    executorId: input.executorId,
    ...(input.sourceNodeId ? { sourceNodeId: input.sourceNodeId } : {}),
    userDescription: {
      name: input.name,
      description: input.description,
    },
    normalizedUnderstanding: {
      runtimeMode: input.inference.runtimeMode,
      capabilities: [...input.inference.capabilityHints],
      tools: [...input.inference.toolHints],
      outputs: [...input.inference.outputHints],
      successCriteria: [...input.inference.successCriteria],
    },
    confidence: input.inference.confidence,
    inferenceRuleIds: [...new Set(ruleIds)],
    understandingState: confirmed ? "confirmed" : "draft",
    understandingVersionBeforeConfirmation: EXECUTOR_UNDERSTANDING_DRAFT_VERSION,
    ...(confirmed ? { confirmedUnderstandingVersion: EXECUTOR_UNDERSTANDING_VERSION } : {}),
    ...(input.now !== undefined ? { generatedAt: input.now } : {}),
  }
}

function runtimeModeFromProfile(profile: ExecutorProfile | undefined): ExecutorRuntimeMode {
  if (!profile) return "unknown"
  return "auto"
}

function profileCapabilities(profile: ExecutorProfile): string[] {
  const capabilities = compactStrings([...profile.delegationScope, ...profile.does])
  return capabilities.length > 0 ? capabilities : ["업무 처리"]
}

function profileOutputs(profile: ExecutorProfile): string[] {
  const outputs = compactStrings(profile.expectedOutputs)
  return outputs.length > 0 ? outputs : ["처리 결과"]
}

function profileSuccessCriteria(profile: ExecutorProfile): string[] {
  const criteria = compactStrings(profile.expectedOutputs.map((output) => `${output}가 기록됨`))
  return criteria.length > 0 ? criteria : ["처리 결과가 기록됨"]
}

function inferConfidence(input: {
  description: string
  hasStoredProfile: boolean
  profileDetailCount: number
  runtimeMode: ExecutorRuntimeMode
}): number {
  const trimmed = input.description.trim()
  let score = input.hasStoredProfile ? 0.66 : 0.42
  if (trimmed.length >= 8) score += 0.12
  if (trimmed.length >= 24) score += 0.08
  score += Math.min(input.profileDetailCount, 4) * 0.03
  if (input.runtimeMode !== "unknown") score += 0.06
  return Number(Math.min(score, 0.92).toFixed(2))
}

function profileDetailCount(profile: ExecutorProfile): number {
  return [
    profile.roleName,
    profile.definition,
    ...profile.does,
    ...profile.delegationScope,
    ...profile.expectedOutputs,
  ].filter((value) => value.trim().length > 0).length
}

function compactStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function buildKoreanSummary(input: {
  name: string
  description: string
  runtimeMode: ExecutorRuntimeMode
  toolHints: string[]
  outputHints: string[]
}): string {
  const name = input.name || "이 실행자"
  const action = input.description || "업무를 처리합니다."
  const tools = input.toolHints.length > 0 ? ` 필요한 도구는 ${input.toolHints.join(", ")}입니다.` : ""
  return `${name}는 ${action} 예상 결과는 ${input.outputHints.join(", ")}입니다.${tools}`
}

function buildEnglishSummary(input: {
  name: string
  description: string
  runtimeMode: ExecutorRuntimeMode
  toolHints: string[]
  outputHints: string[]
}): string {
  const name = input.name || "This executor"
  const action = input.description || "handles the work."
  const tools = input.toolHints.length > 0 ? ` Needed tools: ${input.toolHints.join(", ")}.` : ""
  return `${name} handles: ${action} Expected output: ${input.outputHints.join(", ")}.${tools}`
}

function normalizeRuleKeyword(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣:_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function nodeTypeForRuntimeMode(mode: ExecutorRuntimeMode): ExecutorAdvancedMapping["nodeType"] {
  if (mode === "tool_execution") return "automation_node"
  if (mode === "external") return "external_node"
  return "function"
}

function executorKindForRuntimeMode(mode: ExecutorRuntimeMode): NonNullable<ExecutorDraft["advancedMapping"]>["executorKind"] {
  if (mode === "tool_execution") return "tool"
  if (mode === "external") return "external"
  return "nobie"
}

function executorIdFromName(name: string, now: EnterpriseTimestamp | undefined): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
  const suffix = typeof now === "number" ? String(now) : String(Date.now())
  return `node:${slug || "executor"}-${suffix}`
}

function normalizeAnalysisTimestamp(now: EnterpriseTimestamp): string {
  if (typeof now === "number") return new Date(now).toISOString()
  return now
}
