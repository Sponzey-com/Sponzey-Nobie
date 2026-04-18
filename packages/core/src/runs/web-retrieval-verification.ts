import crypto from "node:crypto"
import type { SourceEvidence, SourceFreshnessPolicy, SourceKind } from "./web-retrieval-policy.js"
import type { RetrievalTargetContract } from "./web-retrieval-session.js"
import { conflictResolutionToVerdict, resolveEvidenceConflict } from "./web-conflict-resolver.js"

export type RetrievalExtractionInputKind = "search_snippet" | "html_text" | "json" | "table" | "browser_text" | "plain_text"
export type RetrievalExtractionMethod = RetrievalExtractionInputKind | "ai_extractor"

export type RetrievalBindingSignalKind =
  | "symbol"
  | "canonical_name"
  | "page_title"
  | "url_path"
  | "quote_card"
  | "table_row"
  | "location"
  | "unit"
  | "timestamp"

export type RetrievalBindingStrength = "strong" | "acceptable" | "weak" | "none"
export type RetrievalVerificationPolicy = SourceFreshnessPolicy | "official_required"

export type RetrievalEvidenceSufficiency =
  | "sufficient_exact"
  | "sufficient_approximate"
  | "partial_but_answerable"
  | "insufficient_candidate_missing"
  | "insufficient_binding_weak"
  | "insufficient_conflict"
  | "blocked"

export interface RetrievalBindingSignal {
  kind: RetrievalBindingSignalKind
  value: string
  weight: number
  evidenceField: string
}

export interface RetrievedValueCandidate {
  id: string
  sourceEvidenceId: string
  targetId: string
  rawValue: string
  normalizedValue: string
  unit: string | null
  labelNearValue: string
  targetLabelNearValue: string | null
  bindingSignals: RetrievalBindingSignal[]
  extractionMethod: RetrievalExtractionMethod
  confidence: number
}

export interface CandidateExtractionHints {
  pageTitle?: string | null
  quoteCardLabel?: string | null
  tableRowLabel?: string | null
  locationLabel?: string | null
  sourceTimestamp?: string | null
}

export interface CandidateExtractionInput {
  sourceEvidenceId: string
  sourceEvidence: SourceEvidence
  target: RetrievalTargetContract
  content: unknown
  inputKind: RetrievalExtractionInputKind
  hints?: CandidateExtractionHints
}

export interface CandidateExtractionFailureEvent {
  eventType: "web_retrieval.candidate_extraction_failed"
  sourceEvidenceId: string
  targetId: string
  reason: string
  inputKind: RetrievalExtractionInputKind
}

export interface RetrievalVerificationVerdict {
  candidateId: string | null
  canAnswer: boolean
  bindingStrength: RetrievalBindingStrength
  evidenceSufficiency: RetrievalEvidenceSufficiency
  rejectionReason: string | null
  policy: RetrievalVerificationPolicy
  sourceEvidenceId: string | null
  targetId: string
  acceptedValue: string | null
  acceptedUnit: string | null
  bindingSignals: RetrievalBindingSignal[]
  conflicts: string[]
  caveats: string[]
}

export interface VerifyRetrievedValueCandidateInput {
  candidate?: RetrievedValueCandidate | null
  target: RetrievalTargetContract
  sourceEvidence?: SourceEvidence | null
  policy: RetrievalVerificationPolicy
}

const VALUE_PATTERN = /(?:[$₩€¥]\s*)?[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(?:°C|℃|%|포인트|points?|pts?|pt|원|달러|USD|KRW)?/giu

const CONFLICT_GROUPS: Array<Record<string, string[]>> = [
  {
    kospi: ["kospi", "코스피"],
    kosdaq: ["kosdaq", "코스닥"],
  },
  {
    nasdaq_composite: ["nasdaq composite", "nasdaq 종합", "나스닥 종합", "ixic", "^ixic", ".ixic"],
    nasdaq_100: ["nasdaq-100", "nasdaq 100", "나스닥 100", "ndx", "^ndx", ".ndx"],
  },
]

function stableStringify(value: unknown): string {
  if (value === undefined) return "null"
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, nested]) => nested !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
  return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`).join(",")}}`
}

function hash(value: unknown): string {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 24)
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ")
}

function normalizeForMatch(value: string | null | undefined): string {
  return normalizeWhitespace(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]+/gu, "")
}

function containsExactNormalized(haystack: string, needle: string | null | undefined): boolean {
  const normalizedNeedle = normalizeForMatch(needle)
  if (!normalizedNeedle) return false
  return normalizeForMatch(haystack).includes(normalizedNeedle)
}

function asText(content: unknown): string {
  if (typeof content === "string") return content
  if (content === null || content === undefined) return ""
  if (Array.isArray(content)) return content.map((item) => asText(item)).join("\n")
  if (typeof content === "object") {
    return Object.entries(content as Record<string, unknown>)
      .map(([key, value]) => `${key}: ${asText(value)}`)
      .join("\n")
  }
  return String(content)
}

function canonicalSourceText(source: SourceEvidence): string {
  return [source.sourceUrl ?? "", source.sourceDomain ?? "", source.sourceLabel ?? ""].filter(Boolean).join(" ")
}

function targetLabels(target: RetrievalTargetContract): Array<{ kind: RetrievalBindingSignalKind; value: string; weight: number; field: string }> {
  const labels: Array<{ kind: RetrievalBindingSignalKind; value: string; weight: number; field: string }> = []
  for (const symbol of target.symbols ?? []) {
    if (symbol.trim()) labels.push({ kind: "symbol", value: symbol, weight: 0.45, field: "target.symbols" })
  }
  if (target.canonicalName?.trim()) labels.push({ kind: "canonical_name", value: target.canonicalName, weight: 0.45, field: "target.canonicalName" })
  if (target.locationName?.trim()) labels.push({ kind: "location", value: target.locationName, weight: 0.45, field: "target.locationName" })
  return labels
}

function firstTargetLabelNearValue(vicinity: string, target: RetrievalTargetContract): string | null {
  for (const label of targetLabels(target)) {
    if (containsExactNormalized(vicinity, label.value)) return label.value
  }
  if (target.rawQuery && containsExactNormalized(vicinity, target.rawQuery)) return target.rawQuery
  return null
}

function addSignal(signals: RetrievalBindingSignal[], signal: RetrievalBindingSignal): void {
  const dedupeKey = `${signal.kind}:${normalizeForMatch(signal.value)}:${signal.evidenceField}`
  if (signals.some((existing) => `${existing.kind}:${normalizeForMatch(existing.value)}:${existing.evidenceField}` === dedupeKey)) return
  signals.push(signal)
}

function buildBindingSignals(input: {
  target: RetrievalTargetContract
  sourceEvidence: SourceEvidence
  vicinity: string
  unit: string | null
  hints?: CandidateExtractionHints
}): RetrievalBindingSignal[] {
  const signals: RetrievalBindingSignal[] = []
  const sourceText = canonicalSourceText(input.sourceEvidence)

  for (const label of targetLabels(input.target)) {
    if (containsExactNormalized(input.vicinity, label.value)) {
      addSignal(signals, { kind: label.kind, value: label.value, weight: label.weight, evidenceField: label.field })
    }
    if (containsExactNormalized(sourceText, label.value)) {
      addSignal(signals, { kind: "url_path", value: label.value, weight: 0.25, evidenceField: "sourceEvidence.sourceUrl" })
    }
    if (input.hints?.pageTitle && containsExactNormalized(input.hints.pageTitle, label.value)) {
      addSignal(signals, { kind: "page_title", value: label.value, weight: 0.3, evidenceField: "hints.pageTitle" })
    }
    if (input.hints?.quoteCardLabel && containsExactNormalized(input.hints.quoteCardLabel, label.value)) {
      addSignal(signals, { kind: "quote_card", value: label.value, weight: 0.35, evidenceField: "hints.quoteCardLabel" })
    }
    if (input.hints?.tableRowLabel && containsExactNormalized(input.hints.tableRowLabel, label.value)) {
      addSignal(signals, { kind: "table_row", value: label.value, weight: 0.35, evidenceField: "hints.tableRowLabel" })
    }
    if (input.hints?.locationLabel && containsExactNormalized(input.hints.locationLabel, label.value)) {
      addSignal(signals, { kind: "location", value: label.value, weight: 0.4, evidenceField: "hints.locationLabel" })
    }
  }

  if (input.unit) addSignal(signals, { kind: "unit", value: input.unit, weight: 0.08, evidenceField: "candidate.unit" })
  if (input.sourceEvidence.sourceTimestamp ?? input.hints?.sourceTimestamp) {
    addSignal(signals, { kind: "timestamp", value: input.sourceEvidence.sourceTimestamp ?? input.hints?.sourceTimestamp ?? "present", weight: 0.08, evidenceField: "sourceTimestamp" })
  }
  return signals
}

function detectUnit(raw: string): string | null {
  if (/°C|℃/iu.test(raw)) return "celsius"
  if (/%/u.test(raw)) return "percent"
  if (/포인트|points?|pts?|pt/iu.test(raw)) return "point"
  if (/₩|원|KRW/iu.test(raw)) return "KRW"
  if (/\$|달러|USD/iu.test(raw)) return "USD"
  if (/€|EUR/iu.test(raw)) return "EUR"
  if (/¥|JPY/iu.test(raw)) return "JPY"
  return null
}

function normalizeValue(raw: string): string {
  const numeric = raw.replace(/[^0-9+\-.]/gu, "")
  const parsed = Number.parseFloat(numeric)
  return Number.isFinite(parsed) ? String(parsed) : normalizeWhitespace(raw)
}

function clampConfidence(value: number): number {
  return Math.max(0.05, Math.min(0.99, Number(value.toFixed(2))))
}

export function extractRetrievedValueCandidates(input: CandidateExtractionInput): RetrievedValueCandidate[] {
  if (!input.sourceEvidenceId.trim()) throw new Error("sourceEvidenceId is required for candidate extraction")
  if (!input.sourceEvidence) throw new Error("sourceEvidence is required for candidate extraction")

  const text = asText(input.content)
  if (!text.trim()) return []

  const candidates: RetrievedValueCandidate[] = []
  for (const match of text.matchAll(VALUE_PATTERN)) {
    const rawValue = normalizeWhitespace(match[0] ?? "")
    if (!rawValue) continue
    const index = match.index ?? 0
    const labelNearValue = normalizeWhitespace(text.slice(Math.max(0, index - 80), Math.min(text.length, index + rawValue.length + 80)))
    const unit = detectUnit(rawValue)
    const bindingSignals = buildBindingSignals({
      target: input.target,
      sourceEvidence: input.sourceEvidence,
      vicinity: labelNearValue,
      unit,
      ...(input.hints ? { hints: input.hints } : {}),
    })
    const targetLabelNearValue = firstTargetLabelNearValue(labelNearValue, input.target)
    const confidence = clampConfidence(0.2 + bindingSignals.reduce((sum, signal) => sum + signal.weight, 0))
    candidates.push({
      id: `candidate:${hash({ sourceEvidenceId: input.sourceEvidenceId, targetId: input.target.targetId, rawValue, index })}`,
      sourceEvidenceId: input.sourceEvidenceId,
      targetId: input.target.targetId,
      rawValue,
      normalizedValue: normalizeValue(rawValue),
      unit,
      labelNearValue,
      targetLabelNearValue,
      bindingSignals,
      extractionMethod: input.inputKind,
      confidence,
    })
  }
  return candidates
}

export function buildCandidateExtractionFailureEvent(input: {
  sourceEvidenceId: string
  targetId: string
  reason: string
  inputKind: RetrievalExtractionInputKind
}): CandidateExtractionFailureEvent {
  return {
    eventType: "web_retrieval.candidate_extraction_failed",
    sourceEvidenceId: input.sourceEvidenceId,
    targetId: input.targetId,
    reason: input.reason,
    inputKind: input.inputKind,
  }
}

function sourceIsOfficialEnough(source: SourceEvidence | null | undefined): boolean {
  if (!source) return false
  return source.sourceKind === "official" || source.sourceKind === "first_party"
}

function signalKinds(candidate: RetrievedValueCandidate): Set<RetrievalBindingSignalKind> {
  return new Set(candidate.bindingSignals.map((signal) => signal.kind))
}

function classifyBindingStrength(candidate: RetrievedValueCandidate): RetrievalBindingStrength {
  const kinds = signalKinds(candidate)
  if (kinds.has("symbol") || kinds.has("canonical_name") || kinds.has("location")) return "strong"
  if (kinds.has("quote_card") || kinds.has("table_row") || kinds.has("page_title") || kinds.has("url_path")) return "acceptable"
  if (kinds.has("unit") || kinds.has("timestamp")) return "weak"
  return "none"
}

function targetConflictBucket(target: RetrievalTargetContract): string | null {
  const text = [target.canonicalName ?? "", ...(target.symbols ?? []), target.rawQuery ?? "", target.locationName ?? ""].join(" ")
  for (const group of CONFLICT_GROUPS) {
    for (const [bucket, labels] of Object.entries(group)) {
      if (labels.some((label) => containsExactNormalized(text, label))) return bucket
    }
  }
  return null
}

function candidateConflictBuckets(candidate: RetrievedValueCandidate): string[] {
  const text = [candidate.labelNearValue, candidate.targetLabelNearValue ?? ""].join(" ")
  const buckets: string[] = []
  for (const group of CONFLICT_GROUPS) {
    for (const [bucket, labels] of Object.entries(group)) {
      if (labels.some((label) => containsExactNormalized(text, label))) buckets.push(bucket)
    }
  }
  return buckets
}

function detectConflicts(candidate: RetrievedValueCandidate, target: RetrievalTargetContract): string[] {
  const targetBucket = targetConflictBucket(target)
  if (!targetBucket) return []
  const candidateBuckets = candidateConflictBuckets(candidate)
  return candidateBuckets.filter((bucket) => bucket !== targetBucket)
}

function hasSourceTimestamp(candidate: RetrievedValueCandidate, source: SourceEvidence | null | undefined): boolean {
  return Boolean(source?.sourceTimestamp?.trim()) || candidate.bindingSignals.some((signal) => signal.kind === "timestamp")
}

function missingCandidateVerdict(target: RetrievalTargetContract, policy: RetrievalVerificationPolicy): RetrievalVerificationVerdict {
  return {
    candidateId: null,
    canAnswer: false,
    bindingStrength: "none",
    evidenceSufficiency: "insufficient_candidate_missing",
    rejectionReason: "candidate_missing",
    policy,
    sourceEvidenceId: null,
    targetId: target.targetId,
    acceptedValue: null,
    acceptedUnit: null,
    bindingSignals: [],
    conflicts: [],
    caveats: [],
  }
}

function rejectVerdict(input: {
  candidate: RetrievedValueCandidate
  target: RetrievalTargetContract
  policy: RetrievalVerificationPolicy
  bindingStrength: RetrievalBindingStrength
  sufficiency: RetrievalEvidenceSufficiency
  rejectionReason: string
  conflicts?: string[]
  caveats?: string[]
}): RetrievalVerificationVerdict {
  return {
    candidateId: input.candidate.id,
    canAnswer: false,
    bindingStrength: input.bindingStrength,
    evidenceSufficiency: input.sufficiency,
    rejectionReason: input.rejectionReason,
    policy: input.policy,
    sourceEvidenceId: input.candidate.sourceEvidenceId,
    targetId: input.target.targetId,
    acceptedValue: null,
    acceptedUnit: null,
    bindingSignals: input.candidate.bindingSignals,
    conflicts: input.conflicts ?? [],
    caveats: input.caveats ?? [],
  }
}

function acceptVerdict(input: {
  candidate: RetrievedValueCandidate
  target: RetrievalTargetContract
  policy: RetrievalVerificationPolicy
  bindingStrength: RetrievalBindingStrength
  sufficiency: RetrievalEvidenceSufficiency
  caveats?: string[]
}): RetrievalVerificationVerdict {
  return {
    candidateId: input.candidate.id,
    canAnswer: true,
    bindingStrength: input.bindingStrength,
    evidenceSufficiency: input.sufficiency,
    rejectionReason: null,
    policy: input.policy,
    sourceEvidenceId: input.candidate.sourceEvidenceId,
    targetId: input.target.targetId,
    acceptedValue: input.candidate.normalizedValue,
    acceptedUnit: input.candidate.unit,
    bindingSignals: input.candidate.bindingSignals,
    conflicts: [],
    caveats: input.caveats ?? [],
  }
}

export function verifyRetrievedValueCandidate(input: VerifyRetrievedValueCandidateInput): RetrievalVerificationVerdict {
  if (!input.candidate) return missingCandidateVerdict(input.target, input.policy)
  const candidate = input.candidate
  if (candidate.targetId !== input.target.targetId) {
    return rejectVerdict({
      candidate,
      target: input.target,
      policy: input.policy,
      bindingStrength: "none",
      sufficiency: "insufficient_binding_weak",
      rejectionReason: "candidate_target_mismatch",
    })
  }

  const conflicts = detectConflicts(candidate, input.target)
  const bindingStrength = classifyBindingStrength(candidate)
  if (conflicts.length > 0) {
    return rejectVerdict({
      candidate,
      target: input.target,
      policy: input.policy,
      bindingStrength,
      sufficiency: "insufficient_conflict",
      rejectionReason: "target_conflict",
      conflicts,
    })
  }
  if (bindingStrength === "weak" || bindingStrength === "none") {
    return rejectVerdict({
      candidate,
      target: input.target,
      policy: input.policy,
      bindingStrength,
      sufficiency: "insufficient_binding_weak",
      rejectionReason: "target_binding_weak",
    })
  }

  if (input.policy === "official_required" && !sourceIsOfficialEnough(input.sourceEvidence)) {
    return rejectVerdict({
      candidate,
      target: input.target,
      policy: input.policy,
      bindingStrength,
      sufficiency: "blocked",
      rejectionReason: "official_source_required",
    })
  }

  if (input.policy === "strict_timestamp" && !hasSourceTimestamp(candidate, input.sourceEvidence)) {
    return rejectVerdict({
      candidate,
      target: input.target,
      policy: input.policy,
      bindingStrength,
      sufficiency: "blocked",
      rejectionReason: "source_timestamp_required",
      caveats: ["strict timestamp policy requires sourceTimestamp before confirming a value"],
    })
  }

  if (input.policy === "latest_approximate") {
    return acceptVerdict({
      candidate,
      target: input.target,
      policy: input.policy,
      bindingStrength,
      sufficiency: bindingStrength === "strong" ? "sufficient_approximate" : "partial_but_answerable",
      caveats: hasSourceTimestamp(candidate, input.sourceEvidence) ? [] : ["collection-time approximate value"],
    })
  }

  if (input.policy === "official_required") {
    return acceptVerdict({
      candidate,
      target: input.target,
      policy: input.policy,
      bindingStrength,
      sufficiency: hasSourceTimestamp(candidate, input.sourceEvidence) ? "sufficient_exact" : "partial_but_answerable",
    })
  }

  return acceptVerdict({
    candidate,
    target: input.target,
    policy: input.policy,
    bindingStrength,
    sufficiency: hasSourceTimestamp(candidate, input.sourceEvidence) ? "sufficient_exact" : "partial_but_answerable",
  })
}

export function verifyRetrievedValueCandidates(input: {
  candidates: RetrievedValueCandidate[]
  target: RetrievalTargetContract
  sourceEvidenceById: Record<string, SourceEvidence>
  policy: RetrievalVerificationPolicy
}): RetrievalVerificationVerdict {
  if (input.candidates.length === 0) return missingCandidateVerdict(input.target, input.policy)
  const verdicts = input.candidates.map((candidate) => verifyRetrievedValueCandidate({
    candidate,
    target: input.target,
    sourceEvidence: input.sourceEvidenceById[candidate.sourceEvidenceId] ?? null,
    policy: input.policy,
  }))
  const conflictResolution = resolveEvidenceConflict({
    target: input.target,
    policy: input.policy,
    verdicts,
    sourceEvidenceById: input.sourceEvidenceById,
  })
  if (conflictResolution.status === "conflict") {
    return conflictResolutionToVerdict({ resolution: conflictResolution, target: input.target, policy: input.policy })
  }
  if (conflictResolution.status === "selected" && conflictResolution.selectedVerdict) return conflictResolution.selectedVerdict
  const answerable = verdicts.find((verdict) => verdict.canAnswer && verdict.bindingStrength === "strong")
    ?? verdicts.find((verdict) => verdict.canAnswer)
  if (answerable) return answerable
  return verdicts.find((verdict) => verdict.evidenceSufficiency === "insufficient_conflict")
    ?? verdicts.find((verdict) => verdict.evidenceSufficiency === "blocked")
    ?? verdicts[0]!
}

export function sourceKindSatisfiesOfficialRequired(kind: SourceKind): boolean {
  return kind === "official" || kind === "first_party"
}
