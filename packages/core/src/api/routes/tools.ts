import type { FastifyInstance } from "fastify"
import { toolDispatcher } from "../../tools/index.js"
import { authMiddleware } from "../middleware/auth.js"

export function registerToolsRoute(app: FastifyInstance): void {
  app.get("/api/tools", { preHandler: authMiddleware }, async (request) => {
    const requestedSource = typeof request.query === "object" && request.query !== null && "source" in request.query
      && typeof (request.query as { source?: unknown }).source === "string"
      ? (request.query as { source: "webui" | "cli" | "telegram" | "slack" }).source
      : null

    const tools = toolDispatcher
      .getAll()
      .filter((t) => !requestedSource || toolDispatcher.isToolAvailableForSource(t, requestedSource))
      .map((t) => ({
      name: t.name,
      description: t.description,
      riskLevel: t.riskLevel,
      requiresApproval: t.requiresApproval,
      }))
    return { tools }
  })
}
