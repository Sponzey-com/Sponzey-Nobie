import {
  CONTRACT_SCHEMA_VERSION,
  buildDeliveryProjection,
  buildToolTargetProjection,
  stableContractHash,
  validateDeliveryContract,
  validateIntentContract,
  validateToolTargetContract,
  type ActionType,
  type DeliveryChannel,
  type DeliveryContract,
  type IntentContract,
  type IntentType,
  type JsonObject,
  type ToolTargetContract,
  type ToolTargetKind,
} from "../contracts/index.js"
import type { RootRun } from "./types.js"

export type ActiveRunProjectionDecisionSource = "explicit_id" | "contract_projection" | "legacy_projection"
export type ExplicitActiveRunTargetKind = "runId" | "requestGroupId" | "approvalId"

export interface ActiveRunContractProjection {
  runId: string
  requestGroupId: string
  lineageRootRunId: string
  approvalId?: string
  status: RootRun["status"]
  source: RootRun["source"]
  displayName: string
  updatedAt: number
  legacy: boolean
  legacyReason?: string
  intentContract: IntentContract
  targetContract: ToolTargetContract
  deliveryContract: DeliveryContract
  comparisonProjection: JsonObject
  comparisonHash: string
}

export interface ExplicitActiveRunTargetResolution {
  kind: ExplicitActiveRunTargetKind
  target: ActiveRunContractProjection
  decisionSource: "explicit_id"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function textOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function readContractRecord(snapshot: Record<string, unknown> | undefined, keys: string[]): unknown {
  if (!snapshot) return undefined
  for (const key of keys) {
    const value = snapshot[key]
    if (value !== undefined) return value
  }
  return undefined
}

function readApprovalId(snapshot: Record<string, unknown> | undefined): string | undefined {
  return textOrUndefined(readContractRecord(snapshot, ["approvalId", "approval_id", "pendingApprovalId"]))
}

function readPersistedIntentContract(snapshot: Record<string, unknown> | undefined): IntentContract | undefined {
  const value = readContractRecord(snapshot, ["intentContract", "intent_contract"])
  const validation = validateIntentContract(value)
  return validation.ok ? validation.value : undefined
}

function readPersistedTargetContract(snapshot: Record<string, unknown> | undefined): ToolTargetContract | undefined {
  const value = readContractRecord(snapshot, ["targetContract", "target_contract"])
  const validation = validateToolTargetContract(value)
  return validation.ok ? validation.value : undefined
}

function readPersistedDeliveryContract(snapshot: Record<string, unknown> | undefined): DeliveryContract | undefined {
  const value = readContractRecord(snapshot, ["deliveryContract", "delivery_contract"])
  const validation = validateDeliveryContract(value)
  return validation.ok ? validation.value : undefined
}

function inferTargetKind(run: RootRun): ToolTargetKind {
  const target = `${run.targetId ?? ""} ${run.targetLabel ?? ""}`.toLowerCase()
  if (/display|screen|monitor|화면|모니터/.test(target)) return "display"
  if (/camera|카메라/.test(target)) return "camera"
  if (/file|path|파일|폴더/.test(target)) return "file"
  if (/extension|yeonjang|연장/.test(target)) return "extension"
  return "unknown"
}

function deliveryChannelFromRunSource(source: RootRun["source"] | undefined): DeliveryChannel {
  switch (source) {
    case "telegram":
      return "telegram"
    case "slack":
      return "slack"
    case "webui":
      return "webui"
    case "cli":
      return "local"
    default:
      return "current_session"
  }
}

export function buildDerivedTargetContract(run: Pick<RootRun, "targetId" | "targetLabel">): ToolTargetContract {
  const targetId = textOrUndefined(run.targetId)
  const displayName = textOrUndefined(run.targetLabel)
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    kind: targetId ? inferTargetKind(run as RootRun) : "unknown",
    ...(targetId ? { id: targetId } : {}),
    selector: null,
    ...(displayName ? { displayName } : {}),
  }
}

export function buildDeliveryContractForRun(run: Pick<RootRun, "source" | "sessionId">): DeliveryContract {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    mode: "reply",
    channel: deliveryChannelFromRunSource(run.source),
    sessionId: run.sessionId,
  }
}

export function buildIncomingIntentContract(params: {
  source?: RootRun["source"]
  sessionId: string
  targetId?: string
  targetLabel?: string
  intentType?: IntentType
  actionType?: ActionType
}): IntentContract {
  const target = buildDerivedTargetContract({
    ...(params.targetId ? { targetId: params.targetId } : {}),
    ...(params.targetLabel ? { targetLabel: params.targetLabel } : {}),
  })
  const delivery = buildDeliveryContractForRun({
    source: params.source ?? "webui",
    sessionId: params.sessionId,
  })
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    intentType: params.intentType ?? "question",
    actionType: params.actionType ?? "answer",
    target,
    delivery,
    constraints: [],
    requiresApproval: false,
  }
}

function buildDerivedIntentContract(run: RootRun, target: ToolTargetContract, delivery: DeliveryContract): IntentContract {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    intentType: "question",
    actionType: "answer",
    target,
    delivery,
    constraints: [],
    requiresApproval: false,
    displayName: run.title,
  }
}

export function buildIntentComparisonProjection(intent: IntentContract): JsonObject {
  return {
    schemaVersion: intent.schemaVersion,
    intentType: intent.intentType,
    actionType: intent.actionType,
    target: buildToolTargetProjection(intent.target),
    delivery: buildDeliveryProjection(intent.delivery),
    constraints: intent.constraints,
    requiresApproval: intent.requiresApproval,
    impossibility: intent.impossibility
      ? {
          reasonCode: intent.impossibility.reasonCode,
        }
      : undefined,
  }
}

export function buildActiveRunProjection(run: RootRun): ActiveRunContractProjection {
  const persistedIntent = readPersistedIntentContract(run.promptSourceSnapshot)
  const persistedTarget = persistedIntent?.target ?? readPersistedTargetContract(run.promptSourceSnapshot)
  const persistedDelivery = persistedIntent?.delivery ?? readPersistedDeliveryContract(run.promptSourceSnapshot)
  const targetContract = persistedTarget ?? buildDerivedTargetContract(run)
  const deliveryContract = persistedDelivery ?? buildDeliveryContractForRun(run)
  const intentContract = persistedIntent ?? buildDerivedIntentContract(run, targetContract, deliveryContract)
  const legacy = !persistedIntent && !persistedTarget && !persistedDelivery
  const comparisonProjection = buildIntentComparisonProjection(intentContract)
  const approvalId = readApprovalId(run.promptSourceSnapshot)

  return {
    runId: run.id,
    requestGroupId: run.requestGroupId,
    lineageRootRunId: run.lineageRootRunId,
    ...(approvalId ? { approvalId } : {}),
    status: run.status,
    source: run.source,
    displayName: run.title || run.targetLabel || run.id,
    updatedAt: run.updatedAt,
    legacy,
    ...(legacy ? { legacyReason: "missing_persisted_contract" } : {}),
    intentContract,
    targetContract,
    deliveryContract,
    comparisonProjection,
    comparisonHash: stableContractHash(comparisonProjection, "active-run"),
  }
}

export function buildActiveRunProjections(runs: RootRun[]): ActiveRunContractProjection[] {
  return runs.map(buildActiveRunProjection)
}

export function resolveExplicitActiveRunTarget(params: {
  candidates: ActiveRunContractProjection[]
  runId?: string
  requestGroupId?: string
  approvalId?: string
}): ExplicitActiveRunTargetResolution | undefined {
  const runId = textOrUndefined(params.runId)
  if (runId) {
    const target = params.candidates.find((candidate) => candidate.runId === runId)
    if (target) return { kind: "runId", target, decisionSource: "explicit_id" }
  }

  const requestGroupId = textOrUndefined(params.requestGroupId)
  if (requestGroupId) {
    const target = params.candidates.find((candidate) => candidate.requestGroupId === requestGroupId)
    if (target) return { kind: "requestGroupId", target, decisionSource: "explicit_id" }
  }

  const approvalId = textOrUndefined(params.approvalId)
  if (approvalId) {
    const target = params.candidates.find((candidate) => candidate.approvalId === approvalId)
    if (target) return { kind: "approvalId", target, decisionSource: "explicit_id" }
  }

  return undefined
}

export function serializeActiveRunCandidateForComparison(candidate: ActiveRunContractProjection): JsonObject {
  return {
    runId: candidate.runId,
    requestGroupId: candidate.requestGroupId,
    lineageRootRunId: candidate.lineageRootRunId,
    approvalId: candidate.approvalId,
    status: candidate.status,
    source: candidate.source,
    legacy: candidate.legacy,
    comparisonHash: candidate.comparisonHash,
    contract: candidate.comparisonProjection,
  }
}

export function hasPersistedComparableContract(candidate: ActiveRunContractProjection): boolean {
  return !candidate.legacy && isRecord(candidate.comparisonProjection)
}
