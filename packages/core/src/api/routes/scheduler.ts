import type { FastifyInstance } from "fastify"
import { authMiddleware } from "../middleware/auth.js"
import { scheduler } from "../../scheduler/index.js"

export function registerSchedulerRoute(app: FastifyInstance): void {
  // GET /api/scheduler/health
  app.get("/api/scheduler/health", { preHandler: authMiddleware }, async () => {
    return scheduler.getHealth()
  })
}
