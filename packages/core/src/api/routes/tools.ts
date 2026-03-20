import type { FastifyInstance } from "fastify"
import { toolDispatcher } from "../../tools/index.js"
import { authMiddleware } from "../middleware/auth.js"

export function registerToolsRoute(app: FastifyInstance): void {
  app.get("/api/tools", { preHandler: authMiddleware }, async () => {
    const tools = toolDispatcher.getAll().map((t) => ({
      name: t.name,
      description: t.description,
      riskLevel: t.riskLevel,
      requiresApproval: t.requiresApproval,
    }))
    return { tools }
  })
}
