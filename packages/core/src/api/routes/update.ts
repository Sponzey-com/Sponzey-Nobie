import type { FastifyInstance } from "fastify"
import { authMiddleware } from "../middleware/auth.js"
import { checkForUpdates, getUpdateSnapshot } from "../../update/service.js"

export function registerUpdateRoute(app: FastifyInstance): void {
  app.get("/api/update/status", { preHandler: authMiddleware }, async () => {
    return getUpdateSnapshot()
  })

  app.post("/api/update/check", { preHandler: authMiddleware }, async () => {
    return checkForUpdates()
  })
}
