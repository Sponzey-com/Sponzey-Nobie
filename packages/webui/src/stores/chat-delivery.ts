export interface ToolCall {
  name: string
  params: unknown
  result?: string
  success?: boolean
}

export interface ArtifactAttachment {
  url: string
  fileName: string
  filePath?: string
  mimeType?: string
  caption?: string
}

interface PendingAssistantRunState {
  sessionId: string
  content: string
  toolCalls: ToolCall[]
  artifacts: ArtifactAttachment[]
}

export interface FlushedAssistantRun {
  runId: string
  content: string
  toolCalls?: ToolCall[]
  artifacts?: ArtifactAttachment[]
}

export function createPendingAssistantTracker() {
  const pendingAssistantByRun = new Map<string, PendingAssistantRunState>()

  return {
    clear() {
      pendingAssistantByRun.clear()
    },

    start(runId: string, sessionId: string) {
      if (pendingAssistantByRun.has(runId)) return
      pendingAssistantByRun.set(runId, {
        sessionId,
        content: "",
        toolCalls: [],
        artifacts: [],
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

    addArtifact(runId: string, artifact: ArtifactAttachment) {
      const current = pendingAssistantByRun.get(runId)
      if (!current) return
      const alreadyPresent = current.artifacts.some((item) =>
        item.url === artifact.url
        && item.fileName === artifact.fileName
        && item.caption === artifact.caption,
      )
      if (alreadyPresent) return
      current.artifacts.push(artifact)
    },

    flush(runId: string): FlushedAssistantRun | null {
      const current = pendingAssistantByRun.get(runId)
      if (!current) return null
      pendingAssistantByRun.delete(runId)

      const content = current.content.trim()
      const hasToolCalls = current.toolCalls.length > 0
      const hasArtifacts = current.artifacts.length > 0
      if (!content && !hasToolCalls && !hasArtifacts) return null

      return {
        runId,
        content,
        ...(hasToolCalls ? { toolCalls: current.toolCalls } : {}),
        ...(hasArtifacts ? { artifacts: current.artifacts } : {}),
      }
    },
  }
}
