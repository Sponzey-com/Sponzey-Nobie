import type {
  CommandRequest,
  OwnerScope,
  ResultReport,
  SubSessionFeedbackCapsulePayload,
  SubSessionHandoffCapsulePayload,
} from "../contracts/sub-agent-orchestration.js"
import type { MemoryCapsule } from "./capsule.js"

function normalizeString(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const value of values) {
    const next = normalizeString(value)
    if (!next || seen.has(next)) continue
    seen.add(next)
    normalized.push(next)
  }
  return normalized
}

function summarizeExpectedOutputs(command: CommandRequest): string[] {
  return uniqueStrings(
    command.expectedOutputs.map((output) =>
      [
        output.outputId,
        output.kind,
        output.description,
        ...output.acceptance.reasonCodes,
      ].join(": "),
    ),
  )
}

function summarizeCarryForwardOutputs(
  resultReports: ResultReport[],
): { keep: string[]; preservedArtifactRefs: string[] } {
  const keep: string[] = []
  const preservedArtifactRefs: string[] = []
  for (const report of resultReports) {
    for (const output of report.outputs) {
      if (output.status === "missing") continue
      keep.push(`${output.outputId}:${output.status}`)
    }
    for (const artifact of report.artifacts) {
      preservedArtifactRefs.push(artifact.path ?? artifact.artifactId)
    }
  }
  return {
    keep: uniqueStrings(keep),
    preservedArtifactRefs: uniqueStrings(preservedArtifactRefs),
  }
}

export function buildSubSessionHandoffCapsulePayload(input: {
  command: CommandRequest
  parentSessionId: string
  latestCapsule?: MemoryCapsule
}): SubSessionHandoffCapsulePayload {
  const latestSafeContextSummary =
    normalizeString(input.latestCapsule?.summary) ??
    uniqueStrings([
      input.command.taskScope.goal,
      ...input.command.taskScope.constraints,
      ...input.command.expectedOutputs.map((output) => output.description),
    ]).join(" / ")

  return {
    kind: "sub_session_handoff_capsule",
    currentGoal: input.command.taskScope.goal,
    completionCriteria: summarizeExpectedOutputs(input.command),
    constraints: uniqueStrings(input.command.taskScope.constraints),
    artifactRefs: uniqueStrings(input.command.contextPackageIds),
    targetContext: {
      targetAgentId: input.command.targetAgentId,
      commandRequestId: input.command.commandRequestId,
      subSessionId: input.command.subSessionId,
      parentRunId: input.command.parentRunId,
      parentSessionId: input.parentSessionId,
    },
    latestSafeContextSummary,
    doNotRepeat: uniqueStrings([]),
    contextPackageIds: uniqueStrings(input.command.contextPackageIds),
  }
}

export function buildSubSessionHandoffPinnedItems(
  payload: SubSessionHandoffCapsulePayload,
): string[] {
  return uniqueStrings([
    `handoff_summary:${payload.latestSafeContextSummary}`,
    ...payload.completionCriteria.map((item) => `completion_criteria:${item}`),
    ...payload.artifactRefs.map((item) => `artifact_ref:${item}`),
    ...payload.doNotRepeat.map((item) => `do_not_repeat:${item}`),
  ])
}

export function buildSubSessionFeedbackCapsulePayload(input: {
  resultReports: ResultReport[]
  requiredChanges: string[]
  additionalConstraints: string[]
  conflictItems: string[]
  sourceResultReportIds: string[]
  expectedOutputRevision: string[]
  reasonCode: string
}): SubSessionFeedbackCapsulePayload {
  const { keep, preservedArtifactRefs } = summarizeCarryForwardOutputs(input.resultReports)
  return {
    kind: "sub_session_feedback_capsule",
    keep,
    remove: uniqueStrings(input.conflictItems),
    revise: uniqueStrings(input.requiredChanges),
    addConstraints: uniqueStrings(input.additionalConstraints),
    doNotRepeat: uniqueStrings([input.reasonCode]),
    expectedOutputRevision: uniqueStrings(input.expectedOutputRevision),
    preservedArtifactRefs,
    unresolvedConflicts: uniqueStrings(input.conflictItems),
    rejectedAssumptions: uniqueStrings(input.conflictItems),
    sourceResultReportIds: uniqueStrings(input.sourceResultReportIds),
  }
}

export function buildSubSessionFeedbackPinnedItems(
  payload: SubSessionFeedbackCapsulePayload,
): string[] {
  return uniqueStrings([
    ...payload.keep.map((item) => `keep:${item}`),
    ...payload.remove.map((item) => `remove:${item}`),
    ...payload.revise.map((item) => `revise:${item}`),
    ...payload.addConstraints.map((item) => `feedback_constraint:${item}`),
    ...payload.doNotRepeat.map((item) => `do_not_repeat:${item}`),
  ])
}

export interface LatestInstructionPrecedenceInput {
  currentInstruction?: string
  latestInstructionSummary?: string
  continuityLastGoodState?: string
  continuityHandoffSummary?: string
}

export interface LatestInstructionPrecedenceResolution {
  selectedSummary?: string
  selectedSource:
    | "current_instruction"
    | "latest_instruction_summary"
    | "continuity_last_good_state"
    | "continuity_handoff_summary"
    | "none"
  staleContinuityIgnored: boolean
}

export function resolveLatestInstructionPrecedence(
  input: LatestInstructionPrecedenceInput,
): LatestInstructionPrecedenceResolution {
  const currentInstruction = normalizeString(input.currentInstruction)
  if (currentInstruction) {
    return {
      selectedSummary: currentInstruction,
      selectedSource: "current_instruction",
      staleContinuityIgnored: true,
    }
  }
  const latestInstructionSummary = normalizeString(input.latestInstructionSummary)
  if (latestInstructionSummary) {
    return {
      selectedSummary: latestInstructionSummary,
      selectedSource: "latest_instruction_summary",
      staleContinuityIgnored: true,
    }
  }
  const lastGoodState = normalizeString(input.continuityLastGoodState)
  if (lastGoodState) {
    return {
      selectedSummary: lastGoodState,
      selectedSource: "continuity_last_good_state",
      staleContinuityIgnored: false,
    }
  }
  const handoffSummary = normalizeString(input.continuityHandoffSummary)
  if (handoffSummary) {
    return {
      selectedSummary: handoffSummary,
      selectedSource: "continuity_handoff_summary",
      staleContinuityIgnored: false,
    }
  }
  return {
    selectedSource: "none",
    staleContinuityIgnored: false,
  }
}

export function buildTaskContinuityTargetContext(input: {
  targetId?: string
  targetLabel?: string
  workerRuntimeKind?: string
  source?: string
  owner?: OwnerScope
}): string | undefined {
  return normalizeString(
    uniqueStrings([
      input.targetLabel,
      input.targetId,
      input.workerRuntimeKind ? `runtime:${input.workerRuntimeKind}` : undefined,
      input.source ? `source:${input.source}` : undefined,
      input.owner ? `owner:${input.owner.ownerType}:${input.owner.ownerId}` : undefined,
    ]).join(" | "),
  )
}
