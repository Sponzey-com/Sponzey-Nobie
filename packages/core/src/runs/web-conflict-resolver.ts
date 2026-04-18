import type { SourceEvidence, SourceKind, SourceReliability } from "./web-retrieval-policy.js"
import type { RetrievalTargetContract } from "./web-retrieval-session.js"
import type {
  RetrievalBindingSignal,
  RetrievalBindingStrength,
  RetrievalEvidenceSufficiency,
  RetrievalVerificationPolicy,
  RetrievalVerificationVerdict,
} from "./web-retrieval-verification.js"

export type EvidenceConflictResolutionStatus = "selected" | "conflict" | "no_answerable_candidate"

export interface EvidenceConflictTolerance {
  absolute: number
  relative: number
}

export interface EvidenceConflictPolicy {
  policyVersion: string
  defaultTolerance: EvidenceConflictTolerance
  financeIndexTolerance: EvidenceConflictTolerance
  weatherCurrentTolerance: EvidenceConflictTolerance
}

export interface EvidenceConflictResolutionInput {
  target: RetrievalTargetContract
  policy: RetrievalVerificationPolicy
  verdicts: RetrievalVerificationVerdict[]
  sourceEvidenceById: Record<string, SourceEvidence>
  adapterPriority?: Record<string, number>
  conflictPolicy?: Partial<EvidenceConflictPolicy>
}

export interface EvidenceConflictResolution {
  status: EvidenceConflictResolutionStatus
  selectedVerdict: RetrievalVerificationVerdict | null
  answerableCount: number
  rejectedWeakCount: number
  conflictingVerdicts: RetrievalVerificationVerdict[]
  conflicts: string[]
  caveats: string[]
  policy: EvidenceConflictPolicy
}

export const DEFAULT_EVIDENCE_CONFLICT_POLICY: EvidenceConflictPolicy = {
  policyVersion: "2026.04.18-task009-conflict-policy-1",
  defaultTolerance: { absolute: 0, relative: 0 },
  financeIndexTolerance: { absolute: 1, relative: 0.001 },
  weatherCurrentTolerance: { absolute: 0.5, relative: 0.02 },
}

const RELIABILITY_SCORE: Record<SourceReliability, number> = {
  high: 40,
  medium: 25,
  low: 10,
  unknown: 0,
}

const SOURCE_KIND_SCORE: Record<SourceKind, number> = {
  official: 30,
  first_party: 25,
  third_party: 15,
  browser_evidence: 12,
  search_index: 8,
  unknown: 0,
}

function mergeConflictPolicy(input?: Partial<EvidenceConflictPolicy>): EvidenceConflictPolicy {
  return {
    ...DEFAULT_EVIDENCE_CONFLICT_POLICY,
    ...(input ?? {}),
    defaultTolerance: { ...DEFAULT_EVIDENCE_CONFLICT_POLICY.defaultTolerance, ...(input?.defaultTolerance ?? {}) },
    financeIndexTolerance: { ...DEFAULT_EVIDENCE_CONFLICT_POLICY.financeIndexTolerance, ...(input?.financeIndexTolerance ?? {}) },
    weatherCurrentTolerance: { ...DEFAULT_EVIDENCE_CONFLICT_POLICY.weatherCurrentTolerance, ...(input?.weatherCurrentTolerance ?? {}) },
  }
}

function numericValue(value: string | null): number | null {
  if (!value) return null
  const parsed = Number.parseFloat(value.replace(/[^0-9+\-.]/g, ""))
  return Number.isFinite(parsed) ? parsed : null
}

function toleranceForTarget(target: RetrievalTargetContract, policy: EvidenceConflictPolicy): EvidenceConflictTolerance {
  if (target.kind === "finance_index") return policy.financeIndexTolerance
  if (target.kind === "weather_current") return policy.weatherCurrentTolerance
  return policy.defaultTolerance
}

function valuesWithinTolerance(left: number, right: number, tolerance: EvidenceConflictTolerance): boolean {
  const absoluteDelta = Math.abs(left - right)
  const base = Math.max(1, Math.abs(left), Math.abs(right))
  return absoluteDelta <= tolerance.absolute || absoluteDelta / base <= tolerance.relative
}

function timestampScore(value: string | null | undefined): number {
  if (!value?.trim()) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? Math.floor(parsed / 1_000) : 1
}

function fetchTimestampScore(value: string | null | undefined): number {
  const parsed = Date.parse(value ?? "")
  return Number.isFinite(parsed) ? Math.floor(parsed / 1_000) : 0
}

function sourceScore(verdict: RetrievalVerificationVerdict, input: EvidenceConflictResolutionInput): number {
  const source = verdict.sourceEvidenceId ? input.sourceEvidenceById[verdict.sourceEvidenceId] : null
  if (!source) return 0
  const adapterPriority = source.adapterId ? input.adapterPriority?.[source.adapterId] ?? 0 : 0
  const degradedPenalty = source.adapterStatus === "degraded" ? 1_000 : 0
  return RELIABILITY_SCORE[source.reliability]
    + SOURCE_KIND_SCORE[source.sourceKind]
    + adapterPriority
    + Math.min(20, timestampScore(source.sourceTimestamp) / 100_000_000)
    + Math.min(10, fetchTimestampScore(source.fetchTimestamp) / 100_000_000)
    - degradedPenalty
}

function verdictPriority(left: RetrievalVerificationVerdict, right: RetrievalVerificationVerdict, input: EvidenceConflictResolutionInput): number {
  const scoreDelta = sourceScore(right, input) - sourceScore(left, input)
  if (scoreDelta !== 0) return scoreDelta
  const leftSource = left.sourceEvidenceId ? input.sourceEvidenceById[left.sourceEvidenceId] : null
  const rightSource = right.sourceEvidenceId ? input.sourceEvidenceById[right.sourceEvidenceId] : null
  return fetchTimestampScore(rightSource?.fetchTimestamp) - fetchTimestampScore(leftSource?.fetchTimestamp)
}

function isAnswerableWithUsableBinding(verdict: RetrievalVerificationVerdict): boolean {
  return verdict.canAnswer
    && verdict.acceptedValue !== null
    && (verdict.bindingStrength === "strong" || verdict.bindingStrength === "acceptable")
}

function bindingIsWeak(verdict: RetrievalVerificationVerdict): boolean {
  return verdict.bindingStrength === "weak" || verdict.bindingStrength === "none"
}

function conflictLabel(verdict: RetrievalVerificationVerdict, source: SourceEvidence | null): string {
  return [
    verdict.acceptedValue ?? "null",
    verdict.acceptedUnit ?? "unitless",
    source?.sourceLabel ?? source?.sourceDomain ?? verdict.sourceEvidenceId ?? "unknown_source",
    source?.sourceTimestamp ?? source?.fetchTimestamp ?? "unknown_time",
  ].join("|")
}

export function resolveEvidenceConflict(input: EvidenceConflictResolutionInput): EvidenceConflictResolution {
  const policy = mergeConflictPolicy(input.conflictPolicy)
  const answerable = input.verdicts.filter(isAnswerableWithUsableBinding)
  const rejectedWeakCount = input.verdicts.filter((verdict) => !verdict.canAnswer && bindingIsWeak(verdict)).length

  if (answerable.length === 0) {
    return {
      status: "no_answerable_candidate",
      selectedVerdict: null,
      answerableCount: 0,
      rejectedWeakCount,
      conflictingVerdicts: [],
      conflicts: [],
      caveats: [],
      policy,
    }
  }

  const sorted = [...answerable].sort((left, right) => verdictPriority(left, right, input))
  const selected = sorted[0]!
  const selectedNumber = numericValue(selected.acceptedValue)
  const tolerance = toleranceForTarget(input.target, policy)
  const conflicts: string[] = []
  const conflictingVerdicts: RetrievalVerificationVerdict[] = []
  let hasDifferentValueWithinTolerance = false

  for (const verdict of sorted.slice(1)) {
    const source = verdict.sourceEvidenceId ? input.sourceEvidenceById[verdict.sourceEvidenceId] ?? null : null
    const value = numericValue(verdict.acceptedValue)
    if (selected.acceptedUnit && verdict.acceptedUnit && selected.acceptedUnit !== verdict.acceptedUnit) {
      continue
    }
    if (selectedNumber !== null && value !== null) {
      if (valuesWithinTolerance(selectedNumber, value, tolerance)) {
        if (selectedNumber !== value) hasDifferentValueWithinTolerance = true
        continue
      }
    } else if (selected.acceptedValue === verdict.acceptedValue) {
      continue
    }
    conflictingVerdicts.push(verdict)
    conflicts.push(conflictLabel(verdict, source))
  }

  if (conflictingVerdicts.length > 0) {
    const selectedSource = selected.sourceEvidenceId ? input.sourceEvidenceById[selected.sourceEvidenceId] ?? null : null
    return {
      status: "conflict",
      selectedVerdict: null,
      answerableCount: answerable.length,
      rejectedWeakCount,
      conflictingVerdicts: [selected, ...conflictingVerdicts],
      conflicts: [conflictLabel(selected, selectedSource), ...conflicts],
      caveats: ["candidate_values_outside_tolerance"],
      policy,
    }
  }

  return {
    status: "selected",
    selectedVerdict: {
      ...selected,
      caveats: [
        ...selected.caveats,
        ...(hasDifferentValueWithinTolerance ? ["candidate_value_variance_within_tolerance"] : []),
      ],
    },
    answerableCount: answerable.length,
    rejectedWeakCount,
    conflictingVerdicts: [],
    conflicts: [],
    caveats: hasDifferentValueWithinTolerance ? ["candidate_value_variance_within_tolerance"] : [],
    policy,
  }
}

export function conflictResolutionToVerdict(input: {
  resolution: EvidenceConflictResolution
  target: RetrievalTargetContract
  policy: RetrievalVerificationPolicy
}): RetrievalVerificationVerdict {
  if (input.resolution.status === "selected" && input.resolution.selectedVerdict) return input.resolution.selectedVerdict
  const signals = input.resolution.conflictingVerdicts.flatMap((verdict) => verdict.bindingSignals)
  return {
    candidateId: null,
    canAnswer: false,
    bindingStrength: signals.length > 0 ? "strong" : "none",
    evidenceSufficiency: input.resolution.status === "conflict" ? "insufficient_conflict" : "insufficient_candidate_missing",
    rejectionReason: input.resolution.status === "conflict" ? "candidate_value_conflict" : "candidate_missing",
    policy: input.policy,
    sourceEvidenceId: null,
    targetId: input.target.targetId,
    acceptedValue: null,
    acceptedUnit: null,
    bindingSignals: dedupeSignals(signals),
    conflicts: input.resolution.conflicts,
    caveats: input.resolution.caveats,
  }
}

function dedupeSignals(signals: RetrievalBindingSignal[]): RetrievalBindingSignal[] {
  const seen = new Set<string>()
  const output: RetrievalBindingSignal[] = []
  for (const signal of signals) {
    const key = `${signal.kind}:${signal.value}:${signal.evidenceField}`
    if (seen.has(key)) continue
    seen.add(key)
    output.push(signal)
  }
  return output
}

export function conflictSufficiencyIsBlocking(value: RetrievalEvidenceSufficiency): boolean {
  return value === "insufficient_conflict" || value === "blocked"
}
