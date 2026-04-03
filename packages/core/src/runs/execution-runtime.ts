import { runAgent } from "../agent/index.js"
import type { AgentChunk, AgentContextMode } from "../agent/index.js"
import type { AIProvider } from "../ai/index.js"

export interface ExecutionChunkStreamParams {
  userMessage: string
  memorySearchQuery: string
  sessionId: string
  runId: string
  model?: string | undefined
  providerId?: string | undefined
  provider?: AIProvider | undefined
  workDir: string
  source: "webui" | "cli" | "telegram"
  signal: AbortSignal
  toolsEnabled?: boolean | undefined
  isRootRequest: boolean
  requestGroupId: string
  contextMode: AgentContextMode
}

export interface ExecutionRuntimeDependencies {
  runAgent: typeof runAgent
}

const defaultExecutionRuntimeDependencies: ExecutionRuntimeDependencies = {
  runAgent,
}

export function createExecutionChunkStream(
  params: ExecutionChunkStreamParams,
  dependencies: ExecutionRuntimeDependencies = defaultExecutionRuntimeDependencies,
): AsyncGenerator<AgentChunk> {
  return dependencies.runAgent({
    userMessage: params.userMessage,
    memorySearchQuery: params.memorySearchQuery,
    sessionId: params.sessionId,
    runId: params.runId,
    ...(params.model ? { model: params.model } : {}),
    ...(params.providerId ? { providerId: params.providerId } : {}),
    ...(params.provider ? { provider: params.provider } : {}),
    workDir: params.workDir,
    source: params.source,
    signal: params.signal,
    ...(params.toolsEnabled === false ? { toolsEnabled: false } : {}),
    ...(params.isRootRequest ? {} : { requestGroupId: params.requestGroupId }),
    contextMode: params.contextMode,
  })
}
