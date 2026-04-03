import type { AgentChunk } from "../agent/index.js"

export type WorkerRuntimeKind = string

export interface WorkerRuntimeTarget {
  kind: WorkerRuntimeKind
  targetId: string
  label: string
  command?: string
}

export interface WorkerAvailabilityOverrides {
  [kind: string]: boolean | undefined
}

export function resolveWorkerRuntimeTarget(kind: WorkerRuntimeKind): WorkerRuntimeTarget {
  return {
    kind,
    targetId: `worker:${kind}`,
    label: "비활성화된 외부 작업 세션",
  }
}

export function isWorkerRuntimeAvailable(
  _kind: WorkerRuntimeKind,
  _overrides?: WorkerAvailabilityOverrides,
): boolean {
  return false
}

export async function* runWorkerRuntime(_params: {
  runtime: WorkerRuntimeTarget
  prompt: string
  sessionId: string
  runId: string
  signal: AbortSignal
}): AsyncGenerator<AgentChunk> {
  yield {
    type: "error",
    message: "External worker runtime execution is removed. Use the configured AI backend only.",
  }
}
