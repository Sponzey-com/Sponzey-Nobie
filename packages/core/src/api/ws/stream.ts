import type { FastifyInstance } from "fastify"
import type { WebSocket } from "@fastify/websocket"
import { eventBus } from "../../events/index.js"
import type { ApprovalDecision, ApprovalResolutionReason } from "../../events/index.js"
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
  eventBus.on("agent.artifact", (e) => broadcast({ type: "agent.artifact", ...e }))
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
  eventBus.on("approval.request", ({ approvalId, runId, toolName, params, kind, guidance, expiresAt, resolve }) => {
    registerApprovalFromWs(runId, resolve, approvalId)
    log.info(`approval.request registered for approvalId=${approvalId ?? "none"} runId=${runId} tool=${toolName}`)
    broadcast({ type: "approval.request", approvalId, runId, toolName, params, kind, guidance, expiresAt })
  })
  eventBus.on("approval.resolved", (e) => {
    pendingApprovals.delete(e.runId)
    if (e.approvalId) pendingApprovals.delete(e.approvalId)
    log.info(`approval.resolved runId=${e.runId} decision=${e.decision} tool=${e.toolName}`)
    broadcast({ type: "approval.resolved", ...e })
  })
  eventBus.on("schedule.created", (e) => broadcast({ type: "schedule.created", ...e }))
  eventBus.on("schedule.cancelled", (e) => broadcast({ type: "schedule.cancelled", ...e }))
  eventBus.on("schedule.run.start", (e) => broadcast({ type: "schedule.run.start", ...e }))
  eventBus.on("schedule.run.complete", (e) => broadcast({ type: "schedule.run.complete", ...e }))
  eventBus.on("schedule.run.failed", (e) => broadcast({ type: "schedule.run.failed", ...e }))
}

// Map of runId → approval resolve fn (for WebSocket-based approval)
const pendingApprovals = new Map<string, (decision: ApprovalDecision, reason?: ApprovalResolutionReason) => void>()

export function registerApprovalFromWs(
  runId: string,
  resolve: (d: ApprovalDecision, reason?: ApprovalResolutionReason) => void,
  approvalId?: string,
): void {
  pendingApprovals.set(runId, resolve)
  if (approvalId) pendingApprovals.set(approvalId, resolve)
}

export interface WebUiApprovalResponseMessage {
  type?: string
  approvalId?: string
  runId?: string
  decision?: string
  toolName?: string
}

export function resolveWebUiApprovalResponse(msg: WebUiApprovalResponseMessage): boolean {
  if (msg.type !== "approval.respond" || !msg.runId) return false

  log.info(
    `approval.respond received runId=${msg.runId} decision=${typeof msg.decision === "string" ? msg.decision : "unknown"} tool=${typeof msg.toolName === "string" ? msg.toolName : "unknown"}`,
  )
  const decision: ApprovalDecision =
    msg.decision === "allow_run"
      ? "allow_run"
      : msg.decision === "allow_once"
        ? "allow_once"
        : "deny"
  const resolve = typeof msg.approvalId === "string"
    ? pendingApprovals.get(msg.approvalId) ?? pendingApprovals.get(msg.runId)
    : pendingApprovals.get(msg.runId)
  if (resolve) {
    resolve(decision, "user")
    pendingApprovals.delete(msg.runId)
    if (typeof msg.approvalId === "string") pendingApprovals.delete(msg.approvalId)
    eventBus.emit("approval.resolved", {
      ...(typeof msg.approvalId === "string" ? { approvalId: msg.approvalId } : {}),
      runId: msg.runId,
      decision,
      toolName: typeof msg.toolName === "string" ? msg.toolName : "unknown",
      reason: "user",
    })
    return true
  }

  if (resolvePendingInteraction(msg.runId, decision)) {
    log.info(`approval.respond fallback resolved runId=${msg.runId} decision=${decision}`)
    eventBus.emit("approval.resolved", {
      ...(typeof msg.approvalId === "string" ? { approvalId: msg.approvalId } : {}),
      runId: msg.runId,
      decision,
      toolName: typeof msg.toolName === "string" ? msg.toolName : "unknown",
      reason: "user",
    })
    return true
  }

  log.warn(`approval.respond ignored: no pending resolver for runId=${msg.runId}`)
  return false
}

export function resetWebUiApprovalStateForTest(): void {
  pendingApprovals.clear()
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
        const msg = JSON.parse(raw.toString()) as { type: string; approvalId?: string; runId?: string; decision?: string; toolName?: string }
        resolveWebUiApprovalResponse(msg)
      } catch { /* ignore malformed messages */ }
    })

    socket.on("close", () => {
      clients.delete(socket)
      log.info(`WebSocket client disconnected (total: ${clients.size})`)
    })
  })
}
