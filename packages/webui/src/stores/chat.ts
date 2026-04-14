import { create } from "zustand"
import type { RootRun } from "../contracts/runs"
import { isAiRelatedError, mapChatErrorMessage } from "../lib/chat-errors"
import { getCurrentUiLanguage } from "./uiLanguage"
import { useRunsStore } from "./runs"
import { createPendingAssistantTracker } from "./chat-delivery"
export type { ArtifactAttachment, ToolCall } from "./chat-delivery"
import type { ArtifactAttachment, ToolCall } from "./chat-delivery"

export interface Message {
  id: string
  runId?: string
  role: "user" | "assistant"
  content: string
  streaming?: boolean
  pendingContent?: string
  toolCalls?: ToolCall[]
  artifacts?: ArtifactAttachment[]
}

export interface ApprovalRequest {
  runId: string
  toolName: string
  params: unknown
  kind?: "approval" | "screen_confirmation"
  guidance?: string
}

interface ChatState {
  sessionId: string | null
  messages: Message[]
  running: boolean
  connected: boolean
  pendingApproval: ApprovalRequest | null
  inputError: string

  setSessionId: (id: string) => void
  setConnected: (v: boolean) => void
  setRunning: (v: boolean) => void
  setInputError: (message: string) => void
  clearInputError: () => void
  addUserMessage: (content: string) => void
  addAssistantMessage: (content: string) => void
  setPendingApproval: (req: ApprovalRequest | null) => void
  clearMessages: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessionId: null,
  messages: [],
  running: false,
  connected: false,
  pendingApproval: null,
  inputError: "",

  setSessionId: (id) => set({ sessionId: id }),
  setConnected: (v) => set({ connected: v }),
  setRunning: (v) => set({ running: v }),
  setInputError: (message) => set({ inputError: message }),
  clearInputError: () => set({ inputError: "" }),

  addUserMessage: (content) =>
    set((s) => ({
      messages: [...s.messages, { id: crypto.randomUUID(), role: "user", content }],
    })),

  addAssistantMessage: (content) =>
    set((s) => ({
      messages: [...s.messages, { id: crypto.randomUUID(), role: "assistant", content }],
    })),

  setPendingApproval: (req) => set({ pendingApproval: req }),

  clearMessages: () => {
    pendingAssistantTracker.clear()
    set({ messages: [], sessionId: null, running: false, pendingApproval: null, inputError: "" })
  },
}))

const pendingAssistantTracker = createPendingAssistantTracker()

export function handleWsMessage(data: { type: string; [k: string]: unknown }) {
  const store = useChatStore.getState()
  const incomingSessionId = typeof data.sessionId === "string" ? data.sessionId : null
  const runId = typeof data.runId === "string" ? data.runId : null
  const activeSessionId = store.sessionId

  switch (data.type) {
    case "run.created":
    case "run.status":
    case "run.progress":
    case "run.completed":
    case "run.failed":
    case "run.cancelled":
      if (data.run) {
        const run = data.run as RootRun
        useRunsStore.getState().upsertRun(run)
        if (!activeSessionId || run.sessionId === activeSessionId) {
          if (run.status === "failed" && isAiRelatedError(run.summary)) {
            store.setInputError(mapChatErrorMessage(run.summary, getCurrentUiLanguage()))
          } else if (run.status === "running" || run.status === "completed") {
            store.clearInputError()
          }
        }
      }
      break

    case "run.step.started":
    case "run.step.completed":
      if (data.run) {
        useRunsStore.getState().upsertRun(data.run as RootRun)
      }
      break

    case "agent.start":
      if (!incomingSessionId || !runId) break
      if (activeSessionId && incomingSessionId !== activeSessionId) break
      pendingAssistantTracker.start(runId, incomingSessionId)
      store.setSessionId(incomingSessionId)
      store.clearInputError()
      store.setRunning(true)
      break

    case "agent.stream":
      if (!incomingSessionId || !runId) break
      if (activeSessionId && incomingSessionId !== activeSessionId) break
      pendingAssistantTracker.start(runId, incomingSessionId)
      appendPendingDelta(runId, data.delta as string)
      break

    case "tool.before":
      if (!incomingSessionId || !runId) break
      if (activeSessionId && incomingSessionId !== activeSessionId) break
      pendingAssistantTracker.start(runId, incomingSessionId)
      addPendingToolCall(runId, { name: data.toolName as string, params: data.params })
      break

    case "tool.after":
      if (!incomingSessionId || !runId) break
      if (activeSessionId && incomingSessionId !== activeSessionId) break
      pendingAssistantTracker.start(runId, incomingSessionId)
      updatePendingToolCall(
        runId,
        data.toolName as string,
        String(data.output ?? ""),
        data.success as boolean,
      )
      break

    case "agent.artifact":
      if (!incomingSessionId || !runId) break
      if (activeSessionId && incomingSessionId !== activeSessionId) break
      pendingAssistantTracker.start(runId, incomingSessionId)
      addPendingArtifact(runId, {
        url: String(data.url ?? ""),
        ...(typeof data.previewUrl === "string" ? { previewUrl: data.previewUrl } : {}),
        ...(typeof data.downloadUrl === "string" ? { downloadUrl: data.downloadUrl } : {}),
        ...(typeof data.previewable === "boolean" ? { previewable: data.previewable } : {}),
        fileName: String(data.fileName ?? ""),
        ...(typeof data.filePath === "string" ? { filePath: data.filePath } : {}),
        ...(typeof data.mimeType === "string" ? { mimeType: data.mimeType } : {}),
        ...(typeof data.caption === "string" ? { caption: data.caption } : {}),
      })
      flushPendingAssistantRun(runId)
      break

    case "agent.end":
      if (!incomingSessionId || !runId) break
      if (activeSessionId && incomingSessionId !== activeSessionId) break
      flushPendingAssistantRun(runId)
      break

    case "approval.request":
      store.setPendingApproval({
        runId: data.runId as string,
        toolName: data.toolName as string,
        params: data.params,
        ...(typeof data.kind === "string" ? { kind: data.kind as ApprovalRequest["kind"] } : {}),
        ...(typeof data.guidance === "string" ? { guidance: data.guidance } : {}),
      })
      break

    case "approval.resolved":
      store.setPendingApproval(null)
      break

    case "ws.init": {
      const runs = Array.isArray(data.runs) ? (data.runs as RootRun[]) : []
      for (const run of runs) {
        useRunsStore.getState().upsertRun(run)
      }

      const interactions = Array.isArray(data.pendingInteractions)
        ? (data.pendingInteractions as Array<{ runId: string; toolName: string; kind?: ApprovalRequest["kind"]; guidance?: string }>)
        : []
      const currentSessionId = store.sessionId
      const knownRuns = useRunsStore.getState().runs
      const matching = interactions.filter((interaction) => {
        const run = knownRuns.find((item) => item.id === interaction.runId)
        return run && (!currentSessionId || run.sessionId === currentSessionId)
      })
      const chosen = currentSessionId
        ? matching[0]
        : interactions.length === 1
          ? matching[0]
          : null
      if (chosen) {
        const run = knownRuns.find((item) => item.id === chosen.runId)
        store.setPendingApproval({
          runId: chosen.runId,
          toolName: chosen.toolName,
          params: { summary: run?.summary ?? "" },
          ...(chosen.kind ? { kind: chosen.kind } : {}),
          ...(chosen.guidance ? { guidance: chosen.guidance } : {}),
        })
      }
      break
    }
  }

  if ((data.type === "run.status" || data.type === "run.completed" || data.type === "run.failed" || data.type === "run.cancelled") && data.run) {
    const run = data.run as RootRun
    if (store.sessionId && run.sessionId !== store.sessionId) {
      return
    }
    const currentPending = useChatStore.getState().pendingApproval
    if (currentPending?.runId === run.id && run.status !== "awaiting_approval" && run.status !== "awaiting_user") {
      store.setPendingApproval(null)
    }
    if (["completed", "failed", "cancelled", "awaiting_user"].includes(run.status)) {
      flushPendingAssistantRun(run.id)
      store.setRunning(false)
    }
  }
}

function appendPendingDelta(runId: string, delta: string): void {
  pendingAssistantTracker.appendDelta(runId, delta)
}

function addPendingToolCall(runId: string, call: ToolCall): void {
  pendingAssistantTracker.addToolCall(runId, call)
}

function updatePendingToolCall(runId: string, name: string, result: string, success: boolean): void {
  pendingAssistantTracker.updateToolCall(runId, name, result, success)
}

function addPendingArtifact(runId: string, artifact: ArtifactAttachment): void {
  if (!artifact.url || !artifact.fileName) return
  pendingAssistantTracker.addArtifact(runId, artifact)
}

function flushPendingAssistantRun(runId: string): void {
  const flushed = pendingAssistantTracker.flush(runId)
  if (!flushed) return

  useChatStore.setState((state) => ({
    messages: [
      ...state.messages,
      {
        id: crypto.randomUUID(),
        runId: flushed.runId,
        role: "assistant",
        content: flushed.content,
        ...(flushed.toolCalls ? { toolCalls: flushed.toolCalls } : {}),
        ...(flushed.artifacts ? { artifacts: flushed.artifacts } : {}),
      },
    ],
  }))
}
