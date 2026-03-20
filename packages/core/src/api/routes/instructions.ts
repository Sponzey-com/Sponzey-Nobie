import type { FastifyInstance } from "fastify"
import { authMiddleware } from "../middleware/auth.js"
import { loadMergedInstructions } from "../../instructions/merge.js"

export function registerInstructionsRoute(app: FastifyInstance): void {
  app.get<{ Querystring: { workDir?: string } }>("/api/instructions/active", { preHandler: authMiddleware }, async (req) => {
    const bundle = loadMergedInstructions(req.query.workDir?.trim() || process.cwd())
    return {
      workDir: bundle.chain.workDir,
      ...(bundle.chain.gitRoot ? { gitRoot: bundle.chain.gitRoot } : {}),
      mergedText: bundle.mergedText,
      sources: bundle.chain.sources.map((source) => ({
        path: source.path,
        scope: source.scope,
        level: source.level,
        loaded: source.loaded,
        size: source.size,
        ...(source.error ? { error: source.error } : {}),
      })),
    }
  })
}
