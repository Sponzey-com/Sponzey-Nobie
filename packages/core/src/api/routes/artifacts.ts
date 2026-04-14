import { createReadStream, existsSync, statSync } from "node:fs"
import { basename, resolve } from "node:path"
import type { FastifyInstance } from "fastify"
import { buildArtifactAccessDescriptor, getArtifactsRoot } from "../../artifacts/lifecycle.js"
import { getLatestArtifactMetadataByPath } from "../../db/index.js"
import { authMiddleware } from "../middleware/auth.js"

function resolveArtifactFile(encodedPath: string): string | null {
  const artifactsRoot = getArtifactsRoot()
  const candidate = resolve(artifactsRoot, encodedPath)
  const access = buildArtifactAccessDescriptor({ filePath: candidate })
  if (!access.ok && access.reason === "outside_state_artifacts") return null
  return candidate
}

export function registerArtifactsRoute(app: FastifyInstance): void {
  app.get<{ Params: { "*": string }; Querystring: { download?: string } }>(
    "/api/artifacts/*",
    { preHandler: authMiddleware },
    async (req, reply) => {
      const encodedPath = req.params["*"] ?? ""
      const filePath = resolveArtifactFile(encodedPath)
      if (!filePath) {
        return reply.status(403).send({ error: "Forbidden" })
      }
      if (!existsSync(filePath)) {
        return reply.status(404).send({ error: "Artifact not found" })
      }

      const stat = statSync(filePath)
      if (!stat.isFile()) {
        return reply.status(404).send({ error: "Artifact not found" })
      }

      const metadata = getLatestArtifactMetadataByPath(filePath)
      if (metadata?.deleted_at || (metadata?.expires_at != null && metadata.expires_at <= Date.now())) {
        return reply.status(410).send({ error: "Artifact expired", message: "This artifact is no longer available." })
      }

      const access = buildArtifactAccessDescriptor({
        filePath,
        sizeBytes: metadata?.size_bytes ?? stat.size,
        expiresAt: metadata?.expires_at ?? null,
        ...(metadata?.mime_type ? { mimeType: metadata.mime_type } : {}),
      })
      if (!access.ok) {
        return reply.status(access.reason === "expired" ? 410 : 403).send({ error: access.reason, message: access.userMessage })
      }

      reply.header("Cache-Control", "private, max-age=300")
      if (req.query.download === "1" || req.query.download === "true") {
        reply.header("Content-Disposition", `attachment; filename="${basename(filePath).replace(/"/g, "")}"`)
      }
      reply.type(access.mimeType)
      return reply.send(createReadStream(filePath))
    },
  )
}
