import {
  condenseMemoryText,
  extractFocusedErrorMessage,
  insertMemoryJournalRecord,
  type MemoryJournalRecordInput,
} from "../memory/journal.js"

export type RunJournalSource = "webui" | "cli" | "telegram"

export interface RunInstructionJournalParams {
  runId: string
  sessionId: string
  requestGroupId: string
  source: RunJournalSource
  message: string
}

export interface RunSuccessJournalParams {
  runId: string
  sessionId: string
  requestGroupId?: string
  source: RunJournalSource
  text: string
  summary: string
}

export interface RunFailureJournalParams {
  runId: string
  sessionId: string
  requestGroupId?: string
  source: RunJournalSource
  summary: string
  detail?: string
  title?: string
}

interface RunJournalDependencies {
  insertRecord: (input: MemoryJournalRecordInput) => string
  onError: (message: string) => void
}

const defaultDependencies: RunJournalDependencies = {
  insertRecord: insertMemoryJournalRecord,
  onError: () => {},
}

export function buildRunInstructionJournalRecord(params: RunInstructionJournalParams): MemoryJournalRecordInput {
  return {
    kind: "instruction",
    title: "instruction",
    content: params.message,
    summary: condenseMemoryText(params.message, 280),
    sessionId: params.sessionId,
    runId: params.runId,
    requestGroupId: params.requestGroupId,
    source: params.source,
    tags: ["instruction"],
  }
}

export function buildRunSuccessJournalRecord(params: RunSuccessJournalParams): MemoryJournalRecordInput {
  return {
    kind: "success",
    title: "success",
    content: params.text,
    summary: condenseMemoryText(params.summary || params.text, 280),
    sessionId: params.sessionId,
    runId: params.runId,
    ...(params.requestGroupId ? { requestGroupId: params.requestGroupId } : {}),
    source: params.source,
    tags: ["success"],
  }
}

export function buildRunFailureJournalRecord(params: RunFailureJournalParams): MemoryJournalRecordInput {
  const detail = params.detail?.trim() || params.summary
  return {
    kind: "failure",
    title: params.title || "failure",
    content: detail,
    summary: extractFocusedErrorMessage(detail, 280) || condenseMemoryText(params.summary, 280),
    sessionId: params.sessionId,
    runId: params.runId,
    ...(params.requestGroupId ? { requestGroupId: params.requestGroupId } : {}),
    source: params.source,
    tags: ["failure"],
  }
}

export function safeInsertRunJournalRecord(
  input: MemoryJournalRecordInput,
  dependencies?: Partial<RunJournalDependencies>,
): void {
  const resolved = { ...defaultDependencies, ...dependencies }
  try {
    resolved.insertRecord(input)
  } catch (error) {
    resolved.onError(`memory journal insert failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}
