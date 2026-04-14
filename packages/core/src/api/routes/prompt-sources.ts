import type { FastifyInstance } from "fastify"
import { authMiddleware } from "../middleware/auth.js"
import {
  checkPromptSourceLocaleParity,
  dryRunPromptSourceAssembly,
  loadPromptSourceRegistry,
  rollbackPromptSourceBackup,
  writePromptSourceWithBackup,
} from "../../memory/nobie-md.js"

function resolveWorkDir(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : process.cwd()
}

function resolveLocale(value: unknown): "ko" | "en" | null {
  return value === "ko" || value === "en" ? value : null
}

export function registerPromptSourcesRoute(app: FastifyInstance): void {
  app.get<{ Querystring: { workDir?: string } }>("/api/prompt-sources", { preHandler: authMiddleware }, async (req) => {
    const workDir = resolveWorkDir(req.query.workDir)
    return {
      workDir,
      sources: loadPromptSourceRegistry(workDir).map(({ content: _content, ...metadata }) => metadata),
    }
  })

  app.get<{ Querystring: { workDir?: string; locale?: string } }>("/api/prompt-sources/dry-run", { preHandler: authMiddleware }, async (req) => {
    const workDir = resolveWorkDir(req.query.workDir)
    const locale = resolveLocale(req.query.locale) ?? "ko"
    return { workDir, locale, dryRun: dryRunPromptSourceAssembly(workDir, locale) }
  })

  app.get<{ Querystring: { workDir?: string } }>("/api/prompt-sources/parity", { preHandler: authMiddleware }, async (req) => {
    const workDir = resolveWorkDir(req.query.workDir)
    return { workDir, parity: checkPromptSourceLocaleParity(workDir) }
  })

  app.get<{
    Params: { sourceId: string; locale: string }
    Querystring: { workDir?: string }
  }>("/api/prompt-sources/:sourceId/:locale", { preHandler: authMiddleware }, async (req, reply) => {
    const locale = resolveLocale(req.params.locale)
    if (!locale) return reply.status(400).send({ error: "invalid prompt source locale" })
    const workDir = resolveWorkDir(req.query.workDir)
    const source = loadPromptSourceRegistry(workDir).find((item) => item.sourceId === req.params.sourceId && item.locale === locale)
    if (!source) return reply.status(404).send({ error: "prompt source not found" })
    return { workDir, source }
  })

  app.post<{
    Params: { sourceId: string; locale: string }
    Body: { workDir?: string; content?: string; createBackup?: boolean }
  }>("/api/prompt-sources/:sourceId/:locale/write", { preHandler: authMiddleware }, async (req, reply) => {
    const locale = resolveLocale(req.params.locale)
    if (!locale) return reply.status(400).send({ error: "invalid prompt source locale" })
    if (typeof req.body?.content !== "string" || !req.body.content.trim()) {
      return reply.status(400).send({ error: "prompt source content is required" })
    }
    try {
      const result = writePromptSourceWithBackup({
        workDir: resolveWorkDir(req.body.workDir),
        sourceId: req.params.sourceId,
        locale,
        content: req.body.content,
        ...(req.body.createBackup !== undefined ? { createBackup: req.body.createBackup } : {}),
      })
      const { content: _content, ...source } = result.source
      return { ...result, source }
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  app.post<{
    Body: { sourcePath?: string; backupPath?: string }
  }>("/api/prompt-sources/rollback", { preHandler: authMiddleware }, async (req, reply) => {
    if (!req.body?.sourcePath || !req.body.backupPath) {
      return reply.status(400).send({ error: "sourcePath and backupPath are required" })
    }
    try {
      return rollbackPromptSourceBackup({ sourcePath: req.body.sourcePath, backupPath: req.body.backupPath })
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : String(error) })
    }
  })
}
