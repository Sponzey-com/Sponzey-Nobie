import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const ROOTS = [
  "packages/core/src/orchestration",
  "packages/core/src/runs/execution-policy.ts",
  "packages/core/src/runs/recovery-budget.ts",
  "packages/core/src/runs/recovery-controller.ts",
  "packages/core/src/runs/recovery-strategy-ledger.ts",
  "packages/core/src/runs/queue-backpressure.ts",
  "packages/core/src/contracts",
  "packages/core/src/index.ts",
  "packages/core/src/index.js",
  "packages/core/src/index.d.ts",
]

const FORBIDDEN = [
  "DEFAULT_MODEL_TIMEOUT_MS",
  "DEFAULT_MODEL_RETRY_COUNT",
  "SubSessionTimeoutError",
  "model_timeout_missing",
  "sub_session_timeout",
  "attempts < maxAttempts",
  "retryCount + 1",
  "ForbiddenTerminalFailureReason",
  "FORBIDDEN_TERMINAL_FAILURE_REASONS",
  "isForbiddenTerminalFailureReason",
] as const

function filesUnder(path: string): string[] {
  const stat = statSync(path)
  if (stat.isFile()) return [path]
  return readdirSync(path)
    .filter((entry) => !entry.startsWith("."))
    .flatMap((entry) => filesUnder(join(path, entry)))
    .filter((file) => /\.(ts|tsx|js|jsx|d\.ts|md)$/.test(file))
}

describe("phase027 static model retry/timeout execution-limit guard", () => {
  it("keeps removed model timeout and retry-limit concepts out of runtime source", () => {
    const hits: string[] = []
    for (const file of ROOTS.flatMap(filesUnder)) {
      const content = readFileSync(file, "utf8")
      for (const token of FORBIDDEN) {
        if (content.includes(token)) hits.push(`${file}: ${token}`)
      }
    }

    expect(hits).toEqual([])
  })
})
