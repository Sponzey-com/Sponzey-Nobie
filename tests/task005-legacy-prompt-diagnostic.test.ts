import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

const { diagnosticEvents, runEvents } = vi.hoisted(() => ({
  diagnosticEvents: [] as Array<{ kind: string; summary: string; detail?: Record<string, unknown> }>,
  runEvents: [] as string[],
}))

vi.mock("../packages/core/src/db/index.js", () => ({
  getDb: () => ({ prepare: () => ({ run: vi.fn() }) }),
  insertSession: vi.fn(),
  getSession: vi.fn(() => null),
  insertMessage: vi.fn(),
  getMessages: vi.fn(() => []),
  getMessagesForRequestGroup: vi.fn(() => []),
  getMessagesForRequestGroupWithRunMeta: vi.fn(() => []),
  getMessagesForRun: vi.fn(() => []),
  getPromptSourceStates: vi.fn(() => []),
  insertDiagnosticEvent: vi.fn((event) => diagnosticEvents.push(event)),
  markMessagesCompressed: vi.fn(),
  updateRunPromptSourceSnapshot: vi.fn(),
  upsertPromptSources: vi.fn(),
  upsertSessionSnapshot: vi.fn(),
  upsertTaskContinuity: vi.fn(),
}))

vi.mock("../packages/core/src/memory/store.js", () => ({
  buildMemoryContext: vi.fn(async () => ""),
  storeMemorySync: vi.fn(),
}))

vi.mock("../packages/core/src/memory/flash-feedback.js", () => ({
  buildFlashFeedbackContext: vi.fn(() => ""),
}))

vi.mock("../packages/core/src/schedules/context.js", () => ({
  buildScheduleMemoryContext: vi.fn(() => ""),
}))

vi.mock("../packages/core/src/instructions/merge.js", () => ({
  loadMergedInstructions: vi.fn(() => ({ mergedText: "" })),
}))

vi.mock("../packages/core/src/tools/dispatcher.js", () => ({
  toolDispatcher: {
    getAll: vi.fn(() => []),
    isToolAvailableForSource: vi.fn(() => true),
    dispatch: vi.fn(),
  },
}))

vi.mock("../packages/core/src/runs/store.js", () => ({
  appendRunEvent: vi.fn((_runId: string, label: string) => runEvents.push(label)),
}))

const { runAgent } = await import("../packages/core/src/agent/index.ts")

const tempDirs: string[] = []

afterEach(() => {
  diagnosticEvents.length = 0
  runEvents.length = 0
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function createWorkDirWithPromptsAndLegacyMemory(): string {
  const root = mkdtempSync(join(tmpdir(), "nobie-task005-legacy-"))
  tempDirs.push(root)
  const promptsDir = join(root, "prompts")
  mkdirSync(promptsDir)
  for (const filename of [
    "definitions.md",
    "identity.md",
    "user.md",
    "soul.md",
    "planner.md",
    "bootstrap.md",
  ]) {
    writeFileSync(join(promptsDir, filename), `# ${filename}\n\n${filename} content`, "utf-8")
  }
  writeFileSync(join(root, "NOBIE.md"), "# legacy project memory\n", "utf-8")
  return root
}

describe("task005 legacy prompt source diagnostics", () => {
  it("records legacy project memory usage after prompt source registry assembly", async () => {
    const workDir = createWorkDirWithPromptsAndLegacyMemory()
    const provider = {
      chat: vi.fn(async function* () {
        yield { type: "message_stop", usage: { input_tokens: 1, output_tokens: 1 } } as const
      }),
    }

    for await (const _chunk of runAgent({
      userMessage: "상태 확인",
      sessionId: "session-legacy",
      runId: "run-legacy",
      model: "gpt-5",
      provider: provider as never,
      workDir,
      toolsEnabled: false,
    })) {
      // drain stream
    }

    expect(runEvents).toContain("prompt_legacy_project_memory_loaded")
    expect(diagnosticEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "legacy_prompt_source_used",
        summary: "Legacy project memory was appended after prompt source registry assembly.",
      }),
    ]))
    expect(JSON.stringify(diagnosticEvents[0]?.detail)).toContain("prompts/ registry first")
  })
})
