import type { FastifyInstance } from "fastify"
import { runDoctor, writeDoctorReportArtifact, type DoctorMode } from "../../diagnostics/doctor.js"
import { authMiddleware } from "../middleware/auth.js"

function resolveMode(value: unknown): DoctorMode {
  return value === "full" ? "full" : "quick"
}

export function registerDoctorRoute(app: FastifyInstance): void {
  app.get<{ Querystring: { mode?: string; json?: string; write?: string } }>("/api/doctor", { preHandler: authMiddleware }, async (req) => {
    const report = runDoctor({ mode: resolveMode(req.query.mode) })
    const artifactPath = req.query.write === "1" || req.query.write === "true"
      ? writeDoctorReportArtifact(report)
      : null
    return { ok: true, report, artifactPath }
  })
}
