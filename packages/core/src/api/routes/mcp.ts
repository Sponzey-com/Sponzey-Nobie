import type { FastifyInstance } from "fastify"
import { mcpRegistry } from "../../mcp/registry.js"
import { authMiddleware } from "../middleware/auth.js"

export function registerMcpRoute(app: FastifyInstance): void {
  app.get("/api/mcp/servers", { preHandler: authMiddleware }, async () => {
    return {
      servers: mcpRegistry.getStatuses(),
      summary: mcpRegistry.getSummary(),
    }
  })

  app.post("/api/mcp/reload", { preHandler: authMiddleware }, async () => {
    await mcpRegistry.reloadFromConfig()
    return {
      servers: mcpRegistry.getStatuses(),
      summary: mcpRegistry.getSummary(),
    }
  })
}
