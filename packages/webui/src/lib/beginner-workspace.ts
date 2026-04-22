import type { RootRun, RunStatus } from "../contracts/runs"
import type { ApprovalRequest, Message, ArtifactAttachment } from "../stores/chat"
import type { UiLanguage } from "../stores/uiLanguage"
import { formatWebUiErrorMessage, uiCatalogText } from "./message-catalog"
import { filterRunsForChatSession } from "./pending-interactions"

export type BeginnerRunCardStatus = "running" | "completed" | "needs_attention" | "failed"

export interface BeginnerRunCard {
  key: string
  status: BeginnerRunCardStatus
  statusLabel: string
  title: string
  summary: string
  updatedAt: number
  canCancel: boolean
  nextAction: { label: string; href: string } | null
}

export interface BeginnerApprovalAction {
  decision: "allow_run" | "allow_once" | "deny"
  label: string
  ariaLabel: string
  tone: "approve" | "once" | "deny"
}

export interface BeginnerApprovalCard {
  title: string
  summary: string
  actions: BeginnerApprovalAction[]
}

export interface BeginnerResultCard {
  key: string
  title: string
  caption: string
  url: string
  downloadUrl: string
  previewUrl?: string
  previewable: boolean
  mimeType?: string
}

export const BEGINNER_CHAT_INPUT_CLASS = "min-h-[3rem] w-full resize-none rounded-2xl border border-stone-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/10 disabled:opacity-50"
export const BEGINNER_CHAT_SCROLL_CLASS = "min-h-0 flex-1 overflow-y-auto p-4 sm:p-6"
export const BEGINNER_CHAT_COMPOSER_CLASS = "sticky bottom-0 z-10 shrink-0 border-t border-stone-200 bg-white/95 px-4 py-3 shadow-[0_-12px_30px_rgba(28,25,23,0.08)] backdrop-blur sm:px-6 sm:py-4"
export const BEGINNER_ACTION_BUTTON_CLASS = "min-h-11 w-full rounded-xl px-4 py-2.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-offset-2 sm:w-auto"

function stripUnsafeText(value: string): string {
  return value
    .replace(/<!doctype[\s\S]*$/giu, "")
    .replace(/<html[\s\S]*$/giu, "")
    .replace(/<script[\s\S]*?<\/script>/giu, "")
    .replace(/<[^>]+>/gu, "")
    .replace(/\b(?:runId|requestGroupId|sessionId|policyVersion|checksum)\s*[:=]\s*[A-Za-z0-9._:-]+/giu, "")
    .replace(/\b(?:raw|stack trace|internal id)\b/giu, "")
    .replace(/\/Users\/[^\s)\]}]+/gu, "[local file]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/giu, "Bearer ***")
    .replace(/sk-[A-Za-z0-9_-]{12,}/gu, "***")
    .replace(/xox[baprs]-[A-Za-z0-9-]{12,}/gu, "***")
    .replace(/\s{2,}/gu, " ")
    .trim()
}

export function sanitizeBeginnerWorkspaceText(value: string | undefined, language: UiLanguage): string {
  const raw = value ?? ""
  if (/\b(?:403|404|401|429|forbidden|unauthorized|rate limit|api key|ai error|internal server error)\b|<!doctype|<html/iu.test(raw)) {
    return formatWebUiErrorMessage(raw, language).message
  }
  const safe = stripUnsafeText(raw)
  if (!safe) return uiCatalogText(language, "beginner.work.summaryPending")
  return safe.length > 160 ? `${safe.slice(0, 157)}...` : safe
}

export function mapBeginnerRunStatus(status: RunStatus): BeginnerRunCardStatus {
  switch (status) {
    case "completed":
      return "completed"
    case "awaiting_approval":
    case "awaiting_user":
      return "needs_attention"
    case "failed":
    case "cancelled":
    case "interrupted":
      return "failed"
    case "queued":
    case "running":
      return "running"
  }
}

export function beginnerRunStatusLabel(status: BeginnerRunCardStatus, language: UiLanguage): string {
  switch (status) {
    case "running": return uiCatalogText(language, "beginner.work.status.running")
    case "completed": return uiCatalogText(language, "beginner.work.status.completed")
    case "needs_attention": return uiCatalogText(language, "beginner.work.status.needsAttention")
    case "failed": return uiCatalogText(language, "beginner.work.status.failed")
  }
}

export function buildBeginnerRunCards(input: {
  runs: RootRun[]
  sessionId: string | null
  language: UiLanguage
  limit?: number
}): BeginnerRunCard[] {
  return filterRunsForChatSession(input.runs, input.sessionId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, input.limit ?? 3)
    .map((run) => {
      const status = mapBeginnerRunStatus(run.status)
      return {
        key: run.id,
        status,
        statusLabel: beginnerRunStatusLabel(status, input.language),
        title: sanitizeBeginnerWorkspaceText(run.title || run.prompt, input.language),
        summary: sanitizeBeginnerWorkspaceText(run.summary, input.language),
        updatedAt: run.updatedAt,
        canCancel: run.canCancel || run.status === "queued" || run.status === "running" || run.status === "awaiting_approval" || run.status === "awaiting_user",
        nextAction: status === "failed"
          ? { label: uiCatalogText(input.language, "beginner.work.failedAction"), href: "/status" }
          : status === "needs_attention"
            ? { label: uiCatalogText(input.language, "beginner.work.needsAttentionAction"), href: "#approval" }
            : null,
      }
    })
}

export function buildBeginnerApprovalCard(approval: ApprovalRequest, language: UiLanguage): BeginnerApprovalCard {
  const isScreenConfirmation = approval.kind === "screen_confirmation"
  const title = isScreenConfirmation
    ? uiCatalogText(language, "beginner.approval.screenTitle")
    : uiCatalogText(language, "beginner.approval.title")
  const fallbackSummary = isScreenConfirmation
    ? uiCatalogText(language, "beginner.approval.screenSummary")
    : uiCatalogText(language, "beginner.approval.summary")
  return {
    title,
    summary: sanitizeBeginnerWorkspaceText(approval.guidance || fallbackSummary, language),
    actions: [
      {
        decision: "allow_run",
        label: isScreenConfirmation ? uiCatalogText(language, "beginner.approval.readyAll") : uiCatalogText(language, "beginner.approval.approveAll"),
        ariaLabel: isScreenConfirmation ? uiCatalogText(language, "beginner.approval.readyAllAria") : uiCatalogText(language, "beginner.approval.approveAllAria"),
        tone: "approve",
      },
      {
        decision: "allow_once",
        label: isScreenConfirmation ? uiCatalogText(language, "beginner.approval.readyOnce") : uiCatalogText(language, "beginner.approval.approveOnce"),
        ariaLabel: isScreenConfirmation ? uiCatalogText(language, "beginner.approval.readyOnceAria") : uiCatalogText(language, "beginner.approval.approveOnceAria"),
        tone: "once",
      },
      {
        decision: "deny",
        label: uiCatalogText(language, "beginner.approval.deny"),
        ariaLabel: uiCatalogText(language, "beginner.approval.denyAria"),
        tone: "deny",
      },
    ],
  }
}

function buildResultKey(message: Message, artifact: ArtifactAttachment, index: number): string {
  return `${message.id}:${artifact.url}:${artifact.fileName}:${index}`
}

export function buildBeginnerResultCards(messages: Message[], language: UiLanguage, limit = 3): BeginnerResultCard[] {
  const cards: BeginnerResultCard[] = []
  for (const message of [...messages].reverse()) {
    if (message.role !== "assistant" || !message.artifacts?.length) continue
    for (const [index, artifact] of message.artifacts.entries()) {
      if (!artifact.url || !artifact.fileName) continue
      cards.push({
        key: buildResultKey(message, artifact, index),
        title: sanitizeBeginnerWorkspaceText(artifact.fileName, language),
        caption: sanitizeBeginnerWorkspaceText(artifact.caption || artifact.fileName, language),
        url: artifact.url,
        downloadUrl: artifact.downloadUrl || artifact.url,
        ...(artifact.previewUrl ? { previewUrl: artifact.previewUrl } : {}),
        previewable: artifact.previewable !== false,
        ...(artifact.mimeType ? { mimeType: artifact.mimeType } : {}),
      })
      if (cards.length >= limit) return cards
    }
  }
  return cards
}
