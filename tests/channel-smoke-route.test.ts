import { createRequire } from "node:module"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { registerChannelSmokeRoute } from "../packages/core/src/api/routes/channel-smoke.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb } from "../packages/core/src/db/index.js"

const require = createRequire(import.meta.url)
const Fastify = require("../packages/core/node_modules/fastify") as (options: { logger: boolean }) => {
  ready(): Promise<void>
  close(): Promise<void>
  inject(options: { method: string; url: string; payload?: unknown }): Promise<{ statusCode: number; json(): any }>
}

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const previousLiveSmoke = process.env["NOBIE_CHANNEL_SMOKE_LIVE"]

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-channel-smoke-route-"))
  tempDirs.push(stateDir)
  process.env["NOBIE_STATE_DIR"] = stateDir
  delete process.env["NOBIE_CONFIG"]
  delete process.env["NOBIE_CHANNEL_SMOKE_LIVE"]
  reloadConfig()
}

beforeEach(() => {
  useTempState()
})

afterEach(() => {
  closeDb()
  if (previousStateDir === undefined) delete process.env["NOBIE_STATE_DIR"]
  else process.env["NOBIE_STATE_DIR"] = previousStateDir
  if (previousConfig === undefined) delete process.env["NOBIE_CONFIG"]
  else process.env["NOBIE_CONFIG"] = previousConfig
  if (previousLiveSmoke === undefined) delete process.env["NOBIE_CHANNEL_SMOKE_LIVE"]
  else process.env["NOBIE_CHANNEL_SMOKE_LIVE"] = previousLiveSmoke
  reloadConfig()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("channel smoke route", () => {
  it("starts a dry-run smoke run, lists it, and exposes sanitized step detail", async () => {
    const app = Fastify({ logger: false })
    registerChannelSmokeRoute(app)
    await app.ready()
    try {
      const started = await app.inject({
        method: "POST",
        url: "/api/channel-smoke/runs",
        payload: { mode: "dry-run", channel: "webui" },
      })
      expect(started.statusCode).toBe(200)
      const startedBody = started.json()
      expect(startedBody.ok).toBe(true)
      expect(startedBody.counts.total).toBe(4)
      expect(startedBody.runId).toBeTruthy()

      const list = await app.inject({ method: "GET", url: "/api/channel-smoke/runs?limit=10" })
      expect(list.statusCode).toBe(200)
      expect(list.json().runs).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: startedBody.runId, mode: "dry-run", status: "passed" }),
      ]))

      const detail = await app.inject({ method: "GET", url: `/api/channel-smoke/runs/${startedBody.runId}` })
      expect(detail.statusCode).toBe(200)
      const detailBody = detail.json()
      expect(detailBody.steps).toHaveLength(4)
      expect(JSON.stringify(detailBody)).not.toMatch(/Bearer\s+|xox[abpr]-|\/Users\//u)
    } finally {
      await app.close()
    }
  })

  it("rejects live-run smoke unless explicitly enabled", async () => {
    const app = Fastify({ logger: false })
    registerChannelSmokeRoute(app)
    await app.ready()
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/channel-smoke/runs",
        payload: { mode: "live-run", channel: "webui" },
      })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual(expect.objectContaining({ error: "live channel smoke requires NOBIE_CHANNEL_SMOKE_LIVE=1" }))
    } finally {
      await app.close()
    }
  })

  it("rejects unknown scenario ids without creating an ambiguous run", async () => {
    const app = Fastify({ logger: false })
    registerChannelSmokeRoute(app)
    await app.ready()
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/channel-smoke/runs",
        payload: { mode: "dry-run", scenarioIds: ["missing.scenario"] },
      })
      expect(response.statusCode).toBe(400)
      expect(response.json().error).toContain("unknown smoke scenario")
    } finally {
      await app.close()
    }
  })
})
