import type { RootRun, RunStep } from "../runs/types.js"

export type ApprovalDecision = "allow_once" | "allow_run" | "deny"
export type ApprovalKind = "approval" | "screen_confirmation"
export type ApprovalResolutionReason = "user" | "timeout" | "abort" | "system"

export interface NobieEvents {
  "message.inbound": { source: string; sessionId: string; content: string; userId?: string }
  "agent.start": { sessionId: string; runId: string }
  "agent.stream": { sessionId: string; runId: string; delta: string }
  "agent.end": { sessionId: string; runId: string; durationMs: number }
  "agent.error": { sessionId: string; runId: string; error: string }
  "run.created": { run: RootRun }
  "run.status": { run: RootRun }
  "run.step.started": { runId: string; step: RunStep; run: RootRun }
  "run.step.completed": { runId: string; step: RunStep; run: RootRun }
  "run.progress": { run: RootRun }
  "run.summary": { runId: string; summary: string; run: RootRun }
  "run.completed": { run: RootRun }
  "run.failed": { run: RootRun }
  "run.cancel.requested": { runId: string }
  "run.cancelled": { run: RootRun }
  "tool.before": { sessionId: string; runId: string; toolName: string; params: unknown }
  "tool.after": {
    sessionId: string
    runId: string
    toolName: string
    success: boolean
    durationMs: number
  }
  "approval.request": {
    runId: string
    toolName: string
    params: unknown
    kind?: ApprovalKind
    guidance?: string
    resolve: (decision: ApprovalDecision, reason?: ApprovalResolutionReason) => void
  }
  "approval.resolved": {
    runId: string
    decision: ApprovalDecision
    toolName: string
    kind?: ApprovalKind
    reason?: ApprovalResolutionReason
  }
  "schedule.created": {
    runId: string
    requestGroupId: string
    registrationKind: "one_time" | "recurring"
    title: string
    task: string
    source: "webui" | "cli" | "telegram"
    scheduleText: string
    scheduleId?: string
    runAtMs?: number
    cron?: string
    targetSessionId?: string
    driver?: string
  }
  "schedule.cancelled": {
    runId: string
    requestGroupId: string
    cancelledScheduleIds: string[]
    cancelledNames: string[]
  }
  "schedule.run.start": {
    scheduleId: string
    scheduleRunId: string
    runId: string
    scheduleName: string
    targetChannel: string
    targetSessionId?: string
    originRunId?: string
    originRequestGroupId?: string
    trigger: string
  }
  "schedule.run.complete": {
    scheduleId: string
    scheduleRunId: string
    runId: string
    scheduleName: string
    targetChannel: string
    targetSessionId?: string
    originRunId?: string
    originRequestGroupId?: string
    trigger: string
    success: boolean
    durationMs: number
    summary?: string
  }
  "schedule.run.failed": {
    scheduleId: string
    scheduleRunId: string
    runId: string
    scheduleName: string
    targetChannel: string
    targetSessionId?: string
    originRunId?: string
    originRequestGroupId?: string
    trigger: string
    error?: string
    attempts: number
  }
  "scheduler.trigger": { scheduleId: string; scheduleTime: Date }
  "config.changed": Record<string, never>
  "plugin.loaded": { pluginId: string }
}

type Listener<T> = (payload: T) => void | Promise<void>

class TypedEventBus {
  private listeners = new Map<string, Set<Listener<unknown>>>()

  on<K extends keyof NobieEvents>(
    event: K,
    listener: Listener<NobieEvents[K]>,
  ): () => void {
    const key = event as string
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set())
    }
    const set = this.listeners.get(key)!
    set.add(listener as Listener<unknown>)
    return () => set.delete(listener as Listener<unknown>)
  }

  emit<K extends keyof NobieEvents>(event: K, payload: NobieEvents[K]): void {
    const key = event as string
    const set = this.listeners.get(key)
    if (!set) return
    for (const listener of set) {
      void Promise.resolve(listener(payload)).catch((err: unknown) => {
        console.error(`[events] Unhandled error in listener for "${key}":`, err)
      })
    }
  }

  once<K extends keyof NobieEvents>(
    event: K,
    listener: Listener<NobieEvents[K]>,
  ): () => void {
    const unsub = this.on(event, (payload) => {
      unsub()
      return listener(payload)
    })
    return unsub
  }
}

export type WizbyEvents = NobieEvents
export type HowieEvents = NobieEvents

export const eventBus = new TypedEventBus()
