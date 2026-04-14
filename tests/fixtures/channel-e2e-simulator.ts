export interface SlackInboundSimulation {
  source: "slack"
  sessionId: string
  runId: string
  channelId: string
  threadTs: string
  userId: string
}

export interface TelegramInboundSimulation {
  source: "telegram"
  sessionId: string
  runId: string
  chatId: number
  threadId?: number
  userId: number
}

export interface WebUiInboundSimulation {
  source: "webui"
  sessionId: string
  runId: string
}

export function createSlackInboundSimulation(overrides: Partial<SlackInboundSimulation> = {}): SlackInboundSimulation {
  return {
    source: "slack",
    sessionId: "session-slack-e2e",
    runId: "run-slack-e2e",
    channelId: "C_E2E",
    threadTs: "1713000000.000100",
    userId: "U_E2E",
    ...overrides,
  }
}

export function createTelegramInboundSimulation(overrides: Partial<TelegramInboundSimulation> = {}): TelegramInboundSimulation {
  return {
    source: "telegram",
    sessionId: "session-telegram-e2e",
    runId: "run-telegram-e2e",
    chatId: 42120565,
    threadId: 1001,
    userId: 7701,
    ...overrides,
  }
}

export function createWebUiInboundSimulation(overrides: Partial<WebUiInboundSimulation> = {}): WebUiInboundSimulation {
  return {
    source: "webui",
    sessionId: "session-webui-e2e",
    runId: "run-webui-e2e",
    ...overrides,
  }
}

export function createDuplicateInboundEventGate() {
  const seen = new Set<string>()

  return {
    accept(params: { source: string; eventId: string }): boolean {
      const key = `${params.source}:${params.eventId}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    },
  }
}

export interface YeonjangCapabilityEvaluation {
  available: boolean
  extensionId: string
  reason: "available" | "mqtt_disconnected" | "capability_missing"
}

export function createYeonjangCapabilityMqttMock(params: {
  extensionId: string
  connected: boolean
  methods: string[]
}) {
  let connected = params.connected
  const methods = new Set(params.methods)

  return {
    setMqttConnected(nextConnected: boolean): void {
      connected = nextConnected
    },
    setCapability(method: string, available: boolean): void {
      if (available) {
        methods.add(method)
      } else {
        methods.delete(method)
      }
    },
    evaluate(method: string): YeonjangCapabilityEvaluation {
      if (!connected) {
        return {
          available: false,
          extensionId: params.extensionId,
          reason: "mqtt_disconnected",
        }
      }
      if (!methods.has(method)) {
        return {
          available: false,
          extensionId: params.extensionId,
          reason: "capability_missing",
        }
      }
      return {
        available: true,
        extensionId: params.extensionId,
        reason: "available",
      }
    },
  }
}
