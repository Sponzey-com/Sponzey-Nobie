export interface ToolCall {
  name: string
  params: unknown
  result?: string
  success?: boolean
}

interface PendingAssistantRunState {
  sessionId: string
  content: string
  toolCalls: ToolCall[]
}

export interface FlushedAssistantRun {
  runId: string
  content: string
  toolCalls?: ToolCall[]
}

export function createPendingAssistantTracker() {
  const pendingAssistantByRun = new Map<string, PendingAssistantRunState>()

  return {
    clear() {
      pendingAssistantByRun.clear()
    },

    start(runId: string, sessionId: string) {
      pendingAssistantByRun.set(runId, {
        sessionId,
        content: "",
        toolCalls: [],
      })
    },

    appendDelta(runId: string, delta: string) {
      const current = pendingAssistantByRun.get(runId)
      if (!current) return
      current.content += delta
    },

    addToolCall(runId: string, call: ToolCall) {
      const current = pendingAssistantByRun.get(runId)
      if (!current) return
      current.toolCalls.push(call)
    },

    updateToolCall(runId: string, name: string, result: string, success: boolean) {
      const current = pendingAssistantByRun.get(runId)
      if (!current) return
      current.toolCalls = current.toolCalls.map((toolCall) =>
        toolCall.name === name && toolCall.result === undefined
          ? { ...toolCall, result, success }
          : toolCall,
      )
    },

    flush(runId: string): FlushedAssistantRun | null {
      const current = pendingAssistantByRun.get(runId)
      if (!current) return null
      pendingAssistantByRun.delete(runId)

      const content = current.content.trim()
      const hasToolCalls = current.toolCalls.length > 0
      if (!content && !hasToolCalls) return null

      return {
        runId,
        content,
        ...(hasToolCalls ? { toolCalls: current.toolCalls } : {}),
      }
    },
  }
}
