import { createRequire } from "node:module"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { AIChunk, AIProvider, ChatParams } from "../packages/core/src/ai/types.js"
import { registerMemoryRoute } from "../packages/core/src/api/routes/memory.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb, insertSession } from "../packages/core/src/db/index.js"
import { closeMemoryJournalDb } from "../packages/core/src/memory/journal.js"
import { executeRootSessionCompaction } from "../packages/core/src/memory/compaction.ts"

const require = createRequire(import.meta.url)
const Fastify = require("../packages/core/node_modules/fastify") as (options: { logger: boolean }) => {
  ready(): Promise<void>
  close(): Promise<void>
  inject(options: { method: string; url: string; payload?: unknown }): Promise<{ statusCode: number; json(): any }>
}

const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const tempDirs: string[] = []

class InspectorProvider implements AIProvider {
  readonly id = "task006-inspector"
  readonly supportedModels = ["compact-inspector"]

  maxContextTokens(): number {
    return 20_000
  }

  async *chat(_params: ChatParams): AsyncGenerator<AIChunk> {
    yield {
      type: "text_delta",
      delta: JSON.stringify({
        what_happened: "inspector summary",
        current_goal: ["memory inspector 확인"],
        still_open: ["pending_approval:approval-task006"],
        confirmed_facts: ["user_locale=ko"],
        must_keep_constraints: ["민감정보 금지"],
        artifacts_and_receipts: ["artifact://task006-screen"],
        tool_side_effect_boundary: ["기존 결과 재사용"],
        retry_do_not_repeat: ["screen_capture#attempt-1"],
        handoff_ready_context: ["safe restore preview available"],
      }),
    }
    yield { type: "message_stop", usage: { input_tokens: 1, output_tokens: 1 } }
  }
}

function useTempState(): void {
  closeDb()
  closeMemoryJournalDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task006-memory-inspector-"))
  tempDirs.push(stateDir)
  const configPath = join(stateDir, "config.json5")
  writeFileSync(configPath, `{
    memory: {
      compaction: {
        modelId: "compact-inspector",
        fallbackModelId: "compact-inspector",
        minContextTokens: 3000
      }
    }
  }`, "utf-8")
  process.env["NOBIE_STATE_DIR"] = stateDir
  process.env["NOBIE_CONFIG"] = configPath
  reloadConfig()
}

async function seedCompaction(): Promise<void> {
  insertSession({
    id: "session-task006-memory-inspector",
    source: "webui",
    source_id: "thread-task006-memory-inspector",
    created_at: Date.now(),
    updated_at: Date.now(),
    summary: "task006 memory inspector",
  })
  const provider = new InspectorProvider()
  await executeRootSessionCompaction({
    provider,
    model: "compact-inspector",
    sessionId: "session-task006-memory-inspector",
    requestGroupId: "group-task006-memory-inspector",
    messages: [
      {
        role: "user",
        content: [
          "active_task:task006-memory-inspector",
          "objective:memory inspector 확인",
          "pending_approval:approval-task006",
          "pending_delivery:telegram:delivery-task006",
          "confirmed_fact:user_locale=ko",
          "constraint:민감정보 금지",
          "decision:기존 결과 재사용",
        ].join("\n"),
      },
    ],
    sourceTokenEstimate: 180_000,
    triggerReasonCodes: ["token_threshold_exceeded"],
  })
}

afterEach(() => {
  closeDb()
  closeMemoryJournalDb()
  if (previousStateDir === undefined) delete process.env["NOBIE_STATE_DIR"]
  else process.env["NOBIE_STATE_DIR"] = previousStateDir
  if (previousConfig === undefined) delete process.env["NOBIE_CONFIG"]
  else process.env["NOBIE_CONFIG"] = previousConfig
  reloadConfig()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("task006 memory inspector api", () => {
  it("returns memory inspector cards, compact preview, and preview-only controls", async () => {
    useTempState()
    await seedCompaction()

    const app = Fastify({ logger: false })
    registerMemoryRoute(app)
    await app.ready()
    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/memory/inspector?sessionId=session-task006-memory-inspector&limit=12",
      })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.snapshot.ownerCards[0]).toEqual(
        expect.objectContaining({
          currentRawTokenEstimate: 180_000,
          currentRawMessageCount: 1,
          pendingPreservationCount: 2,
        }),
      )
      expect(body.snapshot.compactPreview).toEqual(
        expect.objectContaining({
          sourceMessageCount: 1,
          tailMessageCount: 1,
        }),
      )
      expect(body.snapshot.controls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ action: "dry_run_compaction", enabled: true }),
          expect.objectContaining({ action: "safe_restore", enabled: true }),
          expect.objectContaining({ action: "force_compaction", enabled: false }),
        ]),
      )

      const control = await app.inject({
        method: "POST",
        url: "/api/memory/inspector/control",
        payload: {
          action: "safe_restore",
          ownerType: "main_agent",
          ownerId: "agent:nobie",
          sessionId: "session-task006-memory-inspector",
          requestGroupId: "group-task006-memory-inspector",
        },
      })
      expect(control.statusCode).toBe(200)
      const controlBody = control.json()
      expect(controlBody.result.maintenanceRestorePromptBlock).toContain("[maintenance_restore]")
    } finally {
      await app.close()
    }
  })
})
