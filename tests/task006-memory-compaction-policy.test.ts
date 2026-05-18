import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { AIChunk, AIProvider, ChatParams, Message } from "../packages/core/src/ai/types.js"
import { reloadConfig } from "../packages/core/src/config/index.js"
import {
  closeDb,
  insertSession,
  listMemoryCompactionRuns,
} from "../packages/core/src/db/index.js"
import { closeMemoryJournalDb } from "../packages/core/src/memory/journal.js"
import { executeRootSessionCompaction } from "../packages/core/src/memory/compaction.ts"

const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const tempDirs: string[] = []

class PolicyProvider implements AIProvider {
  readonly id = "task006-policy"
  readonly supportedModels = ["execution-model", "compact-primary", "compact-fallback"]
  readonly calls: string[] = []

  constructor(
    private readonly behavior: Record<string, { type: "ok"; payload: Record<string, unknown> } | { type: "fail" }>,
    private readonly budgets: Record<string, number> = {},
  ) {}

  maxContextTokens(model: string): number {
    return this.budgets[model] ?? 16_000
  }

  async *chat(params: ChatParams): AsyncGenerator<AIChunk> {
    this.calls.push(params.model)
    const behavior = this.behavior[params.model] ?? { type: "fail" as const }
    if (behavior.type === "fail") throw new Error(`model failed: ${params.model}`)
    yield { type: "text_delta", delta: JSON.stringify(behavior.payload) }
    yield { type: "message_stop", usage: { input_tokens: 1, output_tokens: 1 } }
  }
}

function useTempState(configBody: string): void {
  closeDb()
  closeMemoryJournalDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task006-memory-policy-"))
  tempDirs.push(stateDir)
  const configPath = join(stateDir, "config.json5")
  writeFileSync(configPath, configBody, "utf-8")
  process.env["NOBIE_STATE_DIR"] = stateDir
  process.env["NOBIE_CONFIG"] = configPath
  reloadConfig()
}

function sampleMessages(): Message[] {
  return [
    {
      role: "user",
      content: [
        "active_task:task006-memory",
        "objective:메모리 compact 상태 점검",
        "pending_approval:approval-1",
        "pending_delivery:telegram:message-1",
        "confirmed_fact:user_locale=ko",
        "constraint:민감정보 금지",
        "decision:기존 결과를 먼저 재사용",
      ].join("\n"),
    },
  ]
}

function seedSession(): void {
  insertSession({
    id: "session-task006-memory-policy",
    source: "webui",
    source_id: "thread-task006-memory-policy",
    created_at: Date.now(),
    updated_at: Date.now(),
    summary: "task006 memory policy",
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

describe("task006 memory compaction model policy", () => {
  it("falls back from explicit compaction model to configured fallback model and records audit", async () => {
    useTempState(`{
      memory: {
        compaction: {
          modelId: "compact-primary",
          fallbackModelId: "compact-fallback",
          minContextTokens: 3000
        }
      }
    }`)
    seedSession()
    const provider = new PolicyProvider({
      "compact-primary": { type: "fail" },
      "compact-fallback": {
        type: "ok",
        payload: {
          what_happened: "fallback summary",
          current_goal: ["점검 마무리"],
          still_open: ["pending_approval:approval-1"],
          confirmed_facts: ["user_locale=ko"],
          must_keep_constraints: ["민감정보 금지"],
          artifacts_and_receipts: [],
          tool_side_effect_boundary: ["기존 결과 재사용"],
          retry_do_not_repeat: [],
          handoff_ready_context: [],
        },
      },
    })

    await executeRootSessionCompaction({
      provider,
      model: "execution-model",
      sessionId: "session-task006-memory-policy",
      requestGroupId: "group-task006-memory-policy",
      messages: sampleMessages(),
      sourceTokenEstimate: 180_000,
      triggerReasonCodes: ["token_threshold_exceeded"],
    })

    expect(provider.calls).toEqual(["compact-primary", "compact-fallback"])
    const run = listMemoryCompactionRuns({ limit: 1 })[0]
    expect(run?.modelId).toBe("compact-fallback")
    expect(run?.metadata?.["compactionModelAudit"]).toEqual(
      expect.objectContaining({
        selectedModelId: "compact-fallback",
        selectionSource: "fallback_override",
        fallbackApplied: true,
        heuristicFallbackApplied: false,
      }),
    )
  })

  it("uses heuristic summary fallback when every compaction model attempt fails or is budget-blocked", async () => {
    useTempState(`{
      memory: {
        compaction: {
          modelId: "compact-primary",
          fallbackModelId: "compact-fallback",
          minContextTokens: 3000
        }
      }
    }`)
    seedSession()
    const provider = new PolicyProvider(
      {
        "execution-model": { type: "fail" },
        "compact-primary": { type: "fail" },
        "compact-fallback": { type: "fail" },
      },
      {
        "compact-primary": 1024,
        "compact-fallback": 1024,
        "execution-model": 1024,
      },
    )

    const result = await executeRootSessionCompaction({
      provider,
      model: "execution-model",
      sessionId: "session-task006-memory-policy",
      requestGroupId: "group-task006-memory-policy",
      messages: sampleMessages(),
      sourceTokenEstimate: 180_000,
      triggerReasonCodes: ["token_threshold_exceeded"],
    })

    expect(result.capsule.summary).toContain("pending_approval:approval-1")
    const run = listMemoryCompactionRuns({ limit: 1 })[0]
    expect(run?.metadata?.["compactionModelAudit"]).toEqual(
      expect.objectContaining({
        providerBudgetBlocked: true,
        heuristicFallbackApplied: true,
      }),
    )
    expect(run?.validationSummary).toContain("heuristic_summary_fallback")
  })
})
