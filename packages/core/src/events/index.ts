export interface SidekickEvents {
  "message.inbound": { source: string; sessionId: string; content: string; userId?: string }
  "agent.start": { sessionId: string; runId: string }
  "agent.stream": { sessionId: string; runId: string; delta: string }
  "agent.end": { sessionId: string; runId: string; durationMs: number }
  "agent.error": { sessionId: string; runId: string; error: string }
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
    resolve: (decision: "allow" | "deny") => void
  }
  "scheduler.trigger": { scheduleId: string; scheduleTime: Date }
  "config.changed": Record<string, never>
  "plugin.loaded": { pluginId: string }
}

type Listener<T> = (payload: T) => void | Promise<void>

class TypedEventBus {
  private listeners = new Map<string, Set<Listener<unknown>>>()

  on<K extends keyof SidekickEvents>(
    event: K,
    listener: Listener<SidekickEvents[K]>,
  ): () => void {
    const key = event as string
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set())
    }
    const set = this.listeners.get(key)!
    set.add(listener as Listener<unknown>)
    return () => set.delete(listener as Listener<unknown>)
  }

  emit<K extends keyof SidekickEvents>(event: K, payload: SidekickEvents[K]): void {
    const key = event as string
    const set = this.listeners.get(key)
    if (!set) return
    for (const listener of set) {
      void Promise.resolve(listener(payload)).catch((err: unknown) => {
        console.error(`[events] Unhandled error in listener for "${key}":`, err)
      })
    }
  }

  once<K extends keyof SidekickEvents>(
    event: K,
    listener: Listener<SidekickEvents[K]>,
  ): () => void {
    const unsub = this.on(event, (payload) => {
      unsub()
      return listener(payload)
    })
    return unsub
  }
}

export const eventBus = new TypedEventBus()
