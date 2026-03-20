import type { FastifyInstance } from "fastify"
import type { WebSocket } from "@fastify/websocket"
import { eventBus } from "../../events/index.js"
import type { ApprovalDecision } from "../../events/index.js"
import { createLogger } from "../../logger/index.js"
import { listPendingInteractions, resolvePendingInteraction } from "../../tools/dispatcher.js"
import { authMiddleware } from "../middleware/auth.js"
import { listRunsForActiveRequestGroups } from "../../runs/store.js"

const log = createLogger("api:ws")

const clients = new Set<WebSocket>()

function broadcast(data: unknown): void {
  const msg = JSON.stringify(data)
  for (const ws of clients) {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(msg)
    }
  }
}

// Forward event bus events to all WebSocket clients
function setupEventForwarding(): void {
  eventBus.on("agent.start", (e) => broadcast({ type: "agent.start", ...e }))
  eventBus.on("agent.stream", (e) => broadcast({ type: "agent.stream", ...e }))
  eventBus.on("agent.end", (e) => broadcast({ type: "agent.end", ...e }))
  eventBus.on("run.created", (e) => broadcast({ type: "run.created", ...e }))
  eventBus.on("run.status", (e) => broadcast({ type: "run.status", ...e }))
  eventBus.on("run.step.started", (e) => broadcast({ type: "run.step.started", ...e }))
  eventBus.on("run.step.completed", (e) => broadcast({ type: "run.step.completed", ...e }))
  eventBus.on("run.progress", (e) => broadcast({ type: "run.progress", ...e }))
  eventBus.on("run.summary", (e) => broadcast({ type: "run.summary", ...e }))
  eventBus.on("run.completed", (e) => broadcast({ type: "run.completed", ...e }))
  eventBus.on("run.failed", (e) => broadcast({ type: "run.failed", ...e }))
  eventBus.on("run.cancel.requested", (e) => broadcast({ type: "run.cancel.requested", ...e }))
  eventBus.on("run.cancelled", (e) => broadcast({ type: "run.cancelled", ...e }))
  eventBus.on("tool.before", (e) => broadcast({ type: "tool.before", ...e }))
  eventBus.on("tool.after", (e) => broadcast({ type: "tool.after", ...e }))
  eventBus.on("approval.request", ({ runId, toolName, params, kind, guidance, resolve }) => {
    registerApprovalFromWs(runId, resolve)
    log.info(`approval.request registered for runId=${runId} tool=${toolName}`)
    broadcast({ type: "approval.request", runId, toolName, params, kind, guidance })
  })
  eventBus.on("approval.resolved", (e) => {
    pendingApprovals.delete(e.runId)
    log.info(`approval.resolved runId=${e.runId} decision=${e.decision} tool=${e.toolName}`)
    broadcast({ type: "approval.resolved", ...e })
  })
  eventBus.on("schedule.run.start" as never, (e: unknown) => broadcast({ type: "schedule.run.start", ...(e as object) }))
  eventBus.on("schedule.run.complete" as never, (e: unknown) => broadcast({ type: "schedule.run.complete", ...(e as object) }))
  eventBus.on("schedule.run.failed" as never, (e: unknown) => broadcast({ type: "schedule.run.failed", ...(e as object) }))
}

// Map of runId → approval resolve fn (for WebSocket-based approval)
const pendingApprovals = new Map<string, (decision: ApprovalDecision) => void>()

export function registerApprovalFromWs(runId: string, resolve: (d: ApprovalDecision) => void): void {
  pendingApprovals.set(runId, resolve)
}

export function registerWsRoute(app: FastifyInstance): void {
  setupEventForwarding()

  app.get("/ws", { websocket: true, preHandler: authMiddleware }, (socket) => {
    clients.add(socket)
    log.info(`WebSocket client connected (total: ${clients.size})`)
    socket.send(JSON.stringify({
      type: "ws.init",
      runs: listRunsForActiveRequestGroups(200, 400),
      pendingInteractions: listPendingInteractions(),
    }))

    socket.on("message", (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type: string; runId?: string; decision?: string; toolName?: string }
        if (msg.type === "approval.respond" && msg.runId) {
          log.info(
            `approval.respond received runId=${msg.runId} decision=${typeof msg.decision === "string" ? msg.decision : "unknown"} tool=${typeof msg.toolName === "string" ? msg.toolName : "unknown"}`,
          )
          const decision: ApprovalDecision =
            msg.decision === "allow_run"
              ? "allow_run"
              : msg.decision === "allow_once"
                ? "allow_once"
                : "deny"
          const resolve = pendingApprovals.get(msg.runId)
          if (resolve) {
            resolve(decision)
            pendingApprovals.delete(msg.runId)
            eventBus.emit("approval.resolved", {
              runId: msg.runId,
              decision,
              toolName: typeof msg.toolName === "string" ? msg.toolName : "unknown",
            })
          } else if (resolvePendingInteraction(msg.runId, decision)) {
            log.info(`approval.respond fallback resolved runId=${msg.runId} decision=${decision}`)
            eventBus.emit("approval.resolved", {
              runId: msg.runId,
              decision,
              toolName: typeof msg.toolName === "string" ? msg.toolName : "unknown",
            })
          } else {
            log.warn(`approval.respond ignored: no pending resolver for runId=${msg.runId}`)
          }
        }
      } catch { /* ignore malformed messages */ }
    })

    socket.on("close", () => {
      clients.delete(socket)
      log.info(`WebSocket client disconnected (total: ${clients.size})`)
    })
  })
}
