import type { FastifyInstance } from "fastify"
import { authMiddleware } from "../middleware/auth.js"
import { createCapabilities } from "../../control-plane/index.js"
import { resolveOrchestrationModeSnapshotSync } from "../../orchestration/mode.js"

export function registerCapabilitiesRoute(app: FastifyInstance): void {
  app.get("/api/capabilities", { preHandler: authMiddleware }, async () => {
    return {
      items: createCapabilities(),
      orchestration: resolveOrchestrationModeSnapshotSync(),
      generatedAt: Date.now(),
    }
  })

  app.get<{ Params: { key: string } }>("/api/capabilities/:key", { preHandler: authMiddleware }, async (req, reply) => {
    const item = createCapabilities().find((capability) => capability.key === req.params.key)
    if (!item) {
      return reply.status(404).send({ error: "Capability not found" })
    }
    return item
  })
}
