import { createServer, type Server as NetServer } from "node:net"
import aedesPackage, { type Client } from "aedes"
import { getConfig } from "../config/index.js"
import { createLogger } from "../logger/index.js"

interface AedesBroker {
  connectedClients: number
  handle: (...args: unknown[]) => unknown
  close: (callback?: () => void) => void
  on: (event: string, listener: (...args: unknown[]) => void) => AedesBroker
}

export interface MqttBrokerSnapshot {
  enabled: boolean
  running: boolean
  host: string
  port: number
  url: string
  clientCount: number
  reason: string | null
}

const log = createLogger("mqtt:broker")

let broker: AedesBroker | null = null
let server: NetServer | null = null
const SNAPSHOT_DEFAULTS: MqttBrokerSnapshot = {
  enabled: false,
  running: false,
  host: "127.0.0.1",
  port: 1883,
  url: "mqtt://127.0.0.1:1883",
  clientCount: 0,
  reason: "MQTT broker is disabled.",
}
let snapshot: MqttBrokerSnapshot = { ...SNAPSHOT_DEFAULTS }

function buildSnapshot(overrides: Partial<MqttBrokerSnapshot>): MqttBrokerSnapshot {
  const base = snapshot
  const host = overrides.host ?? base.host
  const port = overrides.port ?? base.port
  return {
    enabled: overrides.enabled ?? base.enabled,
    running: overrides.running ?? base.running,
    host,
    port,
    url: `mqtt://${host}:${port}`,
    clientCount: overrides.clientCount ?? base.clientCount,
    reason: overrides.reason ?? base.reason,
  }
}

function setSnapshot(overrides: Partial<MqttBrokerSnapshot>): void {
  snapshot = buildSnapshot(overrides)
}

function syncClientCount(): void {
  setSnapshot({ clientCount: broker?.connectedClients ?? 0 })
}

function createAedesBroker(): AedesBroker {
  const candidate = aedesPackage as unknown as {
    createBroker?: () => AedesBroker
  } & (() => AedesBroker)

  if (typeof candidate.createBroker === "function") {
    return candidate.createBroker()
  }

  if (typeof candidate === "function") {
    return candidate()
  }

  throw new Error("Unsupported aedes export shape")
}

export async function startMqttBroker(): Promise<void> {
  const config = getConfig().mqtt
  setSnapshot({
    enabled: config.enabled,
    running: false,
    host: config.host,
    port: config.port,
    clientCount: 0,
    reason: config.enabled ? null : "MQTT broker is disabled.",
  })

  if (!config.enabled) {
    return
  }

  if (server && broker) {
    syncClientCount()
    setSnapshot({ running: true, reason: null })
    return
  }

  const brokerInstance = createAedesBroker()
  const tcpServer = createServer((socket) => {
    brokerInstance.handle(socket)
  })

  brokerInstance.on("clientReady", syncClientCount)
  brokerInstance.on("clientDisconnect", syncClientCount)
  brokerInstance.on("clientError", (client, error) => {
    const clientId = (client as Client | undefined)?.id ?? "unknown"
    const message = error instanceof Error ? error.message : String(error)
    log.warn(`MQTT client error (${clientId}): ${message}`)
  })
  brokerInstance.on("connectionError", (client, error) => {
    const clientId = (client as Client | undefined)?.id ?? "unknown"
    const message = error instanceof Error ? error.message : String(error)
    log.warn(`MQTT connection error (${clientId}): ${message}`)
  })
  brokerInstance.on("closed", () => {
    setSnapshot({
      running: false,
      clientCount: 0,
      reason: snapshot.enabled ? "MQTT broker stopped." : "MQTT broker is disabled.",
    })
  })

  tcpServer.on("error", (error) => {
    setSnapshot({
      running: false,
      reason: error.message,
    })
    log.error(`MQTT server error: ${error.message}`)
  })

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        tcpServer.off("listening", onListening)
        reject(error)
      }
      const onListening = () => {
        tcpServer.off("error", onError)
        resolve()
      }

      tcpServer.once("error", onError)
      tcpServer.once("listening", onListening)
      tcpServer.listen(config.port, config.host)
    })
  } catch (error) {
    tcpServer.removeAllListeners()
    brokerInstance.close()
    setSnapshot({
      running: false,
      clientCount: 0,
      reason: error instanceof Error ? error.message : String(error),
    })
    throw error
  }

  broker = brokerInstance
  server = tcpServer
  syncClientCount()
  setSnapshot({ running: true, reason: null })
  log.info(`MQTT broker listening on mqtt://${config.host}:${config.port}`)
}

export async function stopMqttBroker(): Promise<void> {
  const activeServer = server
  const activeBroker = broker

  server = null
  broker = null

  if (activeServer) {
    await new Promise<void>((resolve, reject) => {
      activeServer.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  }

  if (activeBroker) {
    await new Promise<void>((resolve) => {
      activeBroker.close(resolve)
    })
  }

  setSnapshot({
    running: false,
    clientCount: 0,
    reason: snapshot.enabled ? "MQTT broker stopped." : "MQTT broker is disabled.",
  })

  if (snapshot.enabled) {
    log.info("MQTT broker stopped")
  }
}

export function getMqttBrokerSnapshot(): MqttBrokerSnapshot {
  return { ...snapshot }
}
