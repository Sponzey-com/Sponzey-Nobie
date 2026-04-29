import type { DbChannelMessageRef, DbMessageLedgerEvent } from "../db/index.js"
import {
  findChannelMessageRef,
  findLatestChannelMessageRefForThread,
  getDb,
} from "../db/index.js"
import type { InboundEnvelope } from "./contracts.js"

export type ChannelContinuationLookupStatus = "resolved" | "ambiguous" | "not_found"
export type ChannelContinuationCandidateSource =
  | "explicit_run_id"
  | "explicit_task_id"
  | "delivery_id"
  | "message_ref_exact"
  | "message_ref_parent"
  | "message_ref_thread_root"
  | "message_ref_latest_thread"
  | "sender_room_window"

export interface ChannelContinuationLookupCandidate {
  source: ChannelContinuationCandidateSource
  runId: string
  requestGroupId: string
  sessionId?: string | undefined
  messageRef?: DbChannelMessageRef | undefined
  externalChatId?: string | undefined
  externalThreadId?: string | null | undefined
  externalMessageId?: string | undefined
  deliveryKey?: string | undefined
  confidence: "exact" | "high" | "medium" | "low"
  createdAt: number
}

export interface ChannelContinuationLookupResult {
  status: ChannelContinuationLookupStatus
  candidates: ChannelContinuationLookupCandidate[]
  selected?: ChannelContinuationLookupCandidate | undefined
  confirmationRequired: boolean
  confirmationPrompt?: string | undefined
  reasonCode:
    | "explicit_match"
    | "message_match"
    | "thread_match"
    | "window_match"
    | "ambiguous_candidates"
    | "no_candidates"
}

export interface ChannelContinuationLookupInput {
  envelope: InboundEnvelope
  taskId?: string | undefined
  runId?: string | undefined
  deliveryId?: string | undefined
  lookupWindowMs?: number | undefined
}

const DEFAULT_LOOKUP_WINDOW_MS = 24 * 60 * 60 * 1000

export function resolveChannelContinuation(input: ChannelContinuationLookupInput): ChannelContinuationLookupResult {
  const lookupWindowMs = input.lookupWindowMs ?? DEFAULT_LOOKUP_WINDOW_MS
  const candidates: ChannelContinuationLookupCandidate[] = []
  const explicitRunId = input.runId ?? input.envelope.continuationContext?.runId
  const explicitTaskId = input.taskId ?? input.envelope.continuationContext?.taskId
  const explicitDeliveryId = input.deliveryId ?? input.envelope.continuationContext?.parentDeliveryId

  if (explicitRunId) pushCandidate(candidates, candidateFromRunId(explicitRunId, "explicit_run_id"))
  if (explicitTaskId) pushCandidate(candidates, candidateFromRunId(explicitTaskId, "explicit_task_id"))
  if (explicitDeliveryId) {
    for (const candidate of candidatesFromDeliveryId(explicitDeliveryId)) pushCandidate(candidates, candidate)
  }

  const roomId = input.envelope.room?.id
  if (roomId) {
    const exactIncomingRef = findChannelMessageRef({
      source: input.envelope.provider,
      externalChatId: roomId,
      externalMessageId: input.envelope.messageId,
      ...(input.envelope.threadId ? { externalThreadId: input.envelope.threadId } : {}),
    })
    pushCandidate(candidates, candidateFromMessageRef(exactIncomingRef, "message_ref_exact", "exact"))
    if (exactIncomingRef) return finalizeContinuationResult(candidates)

    const parentMessageId = input.envelope.replyToMessageId
      ?? input.envelope.continuationContext?.parentMessageId
    if (parentMessageId) {
      const parentRef = findChannelMessageRef({
        source: input.envelope.provider,
        externalChatId: roomId,
        externalMessageId: parentMessageId,
        ...(input.envelope.threadId ? { externalThreadId: input.envelope.threadId } : {}),
      })
      pushCandidate(candidates, candidateFromMessageRef(parentRef, "message_ref_parent", "exact"))
      if (parentRef) return finalizeContinuationResult(candidates)
    }

    if (input.envelope.threadId) {
      if (input.envelope.threadId !== input.envelope.messageId) {
        const threadRootRef = findChannelMessageRef({
          source: input.envelope.provider,
          externalChatId: roomId,
          externalMessageId: input.envelope.threadId,
          externalThreadId: input.envelope.threadId,
        })
        pushCandidate(candidates, candidateFromMessageRef(threadRootRef, "message_ref_thread_root", "high"))
      }

      const latestThreadRef = findLatestChannelMessageRefForThread({
        source: input.envelope.provider,
        externalChatId: roomId,
        externalThreadId: input.envelope.threadId,
      })
      pushCandidate(candidates, candidateFromMessageRef(latestThreadRef, "message_ref_latest_thread", "medium"))
    } else if (input.envelope.replyToMessageId) {
      const latestMainRef = findLatestChannelMessageRefForThread({
        source: input.envelope.provider,
        externalChatId: roomId,
      })
      pushCandidate(candidates, candidateFromMessageRef(latestMainRef, "message_ref_latest_thread", "medium"))
    }

    if (!input.envelope.threadId && !input.envelope.replyToMessageId) {
      for (const candidate of candidatesFromSenderRoomWindow({
        provider: input.envelope.provider,
        roomId,
        timestamp: input.envelope.timestamp,
        lookupWindowMs,
      })) {
        pushCandidate(candidates, candidate)
      }
    }
  }

  return finalizeContinuationResult(candidates)
}

export function buildContinuationConfirmationPrompt(candidates: ChannelContinuationLookupCandidate[]): string {
  const count = candidates.length
  return `Found ${count} possible previous Nobie contexts. Please choose which task to continue before this message is attached.`
}

function finalizeContinuationResult(candidates: ChannelContinuationLookupCandidate[]): ChannelContinuationLookupResult {
  const unique = uniqueCandidates(candidates)
  if (unique.length === 0) {
    return {
      status: "not_found",
      candidates: [],
      confirmationRequired: false,
      reasonCode: "no_candidates",
    }
  }

  const exact = unique.filter((candidate) => candidate.confidence === "exact")
  const selectedPool = exact.length > 0 ? exact : unique
  const groupedByRequest = new Map<string, ChannelContinuationLookupCandidate[]>()
  for (const candidate of selectedPool) {
    const key = candidate.requestGroupId || candidate.runId
    const existing = groupedByRequest.get(key)
    if (existing) existing.push(candidate)
    else groupedByRequest.set(key, [candidate])
  }

  if (groupedByRequest.size === 1) {
    const selected = [...groupedByRequest.values()][0]!
      .sort((left, right) => rankCandidate(right) - rankCandidate(left) || right.createdAt - left.createdAt)[0]!
    return {
      status: "resolved",
      candidates: unique,
      selected,
      confirmationRequired: false,
      reasonCode: selected.source.startsWith("explicit")
        ? "explicit_match"
        : selected.source.includes("thread")
          ? "thread_match"
          : selected.source === "sender_room_window"
            ? "window_match"
            : "message_match",
    }
  }

  return {
    status: "ambiguous",
    candidates: unique,
    confirmationRequired: true,
    confirmationPrompt: buildContinuationConfirmationPrompt(unique),
    reasonCode: "ambiguous_candidates",
  }
}

function candidateFromRunId(
  runId: string,
  source: "explicit_run_id" | "explicit_task_id",
): ChannelContinuationLookupCandidate | null {
  const normalized = runId.trim()
  if (!normalized) return null
  const row = getDb()
    .prepare<[string, string], { id: string; request_group_id: string | null; session_id: string | null; created_at: number | null }>(
      `SELECT id, request_group_id, session_id, created_at
       FROM root_runs
       WHERE id = ? OR request_group_id = ?
       ORDER BY updated_at DESC
       LIMIT 1`,
    )
    .get(normalized, normalized)
  if (!row) return null
  return {
    source,
    runId: row.id,
    requestGroupId: row.request_group_id ?? row.id,
    ...(row.session_id ? { sessionId: row.session_id } : {}),
    confidence: "exact",
    createdAt: row.created_at ?? Date.now(),
  }
}

function candidatesFromDeliveryId(deliveryId: string): ChannelContinuationLookupCandidate[] {
  const normalized = deliveryId.trim()
  if (!normalized) return []
  const rows = getDb()
    .prepare<[string, string], DbMessageLedgerEvent>(
      `SELECT *
       FROM message_ledger
       WHERE delivery_key = ? OR id = ?
       ORDER BY created_at DESC
       LIMIT 20`,
    )
    .all(normalized, normalized)
  return rows
    .map((event) => candidateFromLedgerEvent(event, "delivery_id"))
    .filter((candidate): candidate is ChannelContinuationLookupCandidate => candidate !== null)
}

function candidateFromLedgerEvent(
  event: DbMessageLedgerEvent,
  source: ChannelContinuationCandidateSource,
): ChannelContinuationLookupCandidate | null {
  if (!event.run_id && !event.request_group_id) return null
  const runId = event.run_id ?? event.request_group_id
  if (!runId) return null
  return {
    source,
    runId,
    requestGroupId: event.request_group_id ?? runId,
    ...(event.session_key ? { sessionId: event.session_key } : {}),
    ...(event.delivery_key ? { deliveryKey: event.delivery_key } : {}),
    confidence: "exact",
    createdAt: event.created_at,
  }
}

function candidateFromMessageRef(
  ref: DbChannelMessageRef | undefined,
  source: ChannelContinuationCandidateSource,
  confidence: ChannelContinuationLookupCandidate["confidence"],
): ChannelContinuationLookupCandidate | null {
  if (!ref) return null
  return {
    source,
    runId: ref.root_run_id,
    requestGroupId: ref.request_group_id,
    sessionId: ref.session_id,
    messageRef: ref,
    externalChatId: ref.external_chat_id,
    externalThreadId: ref.external_thread_id,
    externalMessageId: ref.external_message_id,
    confidence,
    createdAt: ref.created_at,
  }
}

function candidatesFromSenderRoomWindow(input: {
  provider: string
  roomId: string
  timestamp: number
  lookupWindowMs: number
}): ChannelContinuationLookupCandidate[] {
  const since = Math.max(0, input.timestamp - input.lookupWindowMs)
  const rows = getDb()
    .prepare<[string, string, number, number], DbChannelMessageRef>(
      `SELECT *
       FROM channel_message_refs
       WHERE source = ?
         AND external_chat_id = ?
         AND created_at BETWEEN ? AND ?
         AND role IN ('assistant', 'tool')
       ORDER BY created_at DESC
       LIMIT 10`,
    )
    .all(input.provider, input.roomId, since, input.timestamp)
  return rows
    .map((ref) => candidateFromMessageRef(ref, "sender_room_window", "low"))
    .filter((candidate): candidate is ChannelContinuationLookupCandidate => candidate !== null)
}

function pushCandidate(
  candidates: ChannelContinuationLookupCandidate[],
  candidate: ChannelContinuationLookupCandidate | null,
): void {
  if (!candidate) return
  candidates.push(candidate)
}

function uniqueCandidates(candidates: ChannelContinuationLookupCandidate[]): ChannelContinuationLookupCandidate[] {
  const byKey = new Map<string, ChannelContinuationLookupCandidate>()
  for (const candidate of candidates) {
    const key = [
      candidate.runId,
      candidate.requestGroupId,
      candidate.externalMessageId ?? "",
      candidate.deliveryKey ?? "",
    ].join(":")
    const existing = byKey.get(key)
    if (!existing || rankCandidate(candidate) > rankCandidate(existing) || candidate.createdAt > existing.createdAt) {
      byKey.set(key, candidate)
    }
  }
  return [...byKey.values()].sort((left, right) => rankCandidate(right) - rankCandidate(left) || right.createdAt - left.createdAt)
}

function rankCandidate(candidate: ChannelContinuationLookupCandidate): number {
  switch (candidate.confidence) {
    case "exact":
      return 4
    case "high":
      return 3
    case "medium":
      return 2
    case "low":
      return 1
  }
}
