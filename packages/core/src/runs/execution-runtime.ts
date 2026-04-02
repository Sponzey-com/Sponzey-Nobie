import { runAgent } from "../agent/index.js"
import type { AgentChunk, AgentContextMode } from "../agent/index.js"
import { loadMergedInstructions } from "../instructions/merge.js"
import type { LLMProvider } from "../llm/index.js"
import { loadNobieMd } from "../memory/nobie-md.js"
import type { WorkerRuntimeTarget } from "./worker-runtime.js"
import { runWorkerRuntime } from "./worker-runtime.js"

export interface ExecutionChunkStreamParams {
  workerRuntime?: WorkerRuntimeTarget | undefined
  userMessage: string
  memorySearchQuery: string
  sessionId: string
  runId: string
  model?: string | undefined
  providerId?: string | undefined
  provider?: LLMProvider | undefined
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
  runWorkerRuntime: typeof runWorkerRuntime
}

const defaultExecutionRuntimeDependencies: ExecutionRuntimeDependencies = {
  runAgent,
  runWorkerRuntime,
}

export function buildWorkerRuntimePrompt(message: string, workDir: string): string {
  const instructions = loadMergedInstructions(workDir)
  const nobieMd = loadNobieMd(workDir)
  return [
    instructions.mergedText ? `[Instruction Chain]\n${instructions.mergedText}` : "",
    nobieMd ? `[프로젝트 메모리]\n${nobieMd}` : "",
    message,
  ]
    .filter(Boolean)
    .join("\n\n")
}

export function createExecutionChunkStream(
  params: ExecutionChunkStreamParams,
  dependencies: ExecutionRuntimeDependencies = defaultExecutionRuntimeDependencies,
): AsyncGenerator<AgentChunk> {
  if (params.workerRuntime) {
    return dependencies.runWorkerRuntime({
      runtime: params.workerRuntime,
      prompt: buildWorkerRuntimePrompt(params.userMessage, params.workDir),
      sessionId: params.sessionId,
      runId: params.runId,
      signal: params.signal,
    })
  }

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
