import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  criticalDecisionSourceScanRules,
  getCriticalDecisionAuditEntry,
} from "../packages/core/src/runs/critical-decision-audit.ts"

interface ForbiddenPatternRule {
  ruleId: string
  description: string
  pattern: RegExp
}

interface AllowedNonExecutionStringHandling {
  file: string
  category:
    | "security-redaction"
    | "parser-or-normalizer"
    | "display-only"
    | "source-adapter-value-extraction"
  reason: string
}

interface Finding {
  file: string
  ruleId: string
  description: string
}

const coreDecisionScanRoots = [
  "packages/core/src/runs",
  "packages/core/src/orchestration",
  "packages/core/src/topology",
  "packages/core/src/topology-runtime",
]

const explicitCoreDecisionFiles = [
  "packages/core/src/agent/intake-prompt.ts",
  "packages/core/src/agent/request-normalizer.ts",
]

const forbiddenPatternRules: ForbiddenPatternRule[] = [
  {
    ruleId: "keyword-table",
    description: "KEYWORDS tables must not drive executor, relation, or tool decisions.",
    pattern: /\bKEYWORDS\b/u,
  },
  {
    ruleId: "looks-like-request",
    description: "looksLike*Request helpers usually reclassify raw user text outside the execution contract.",
    pattern: /\blooksLike[A-Za-z0-9_]*Request\b/u,
  },
  {
    ruleId: "detect-intent-from-raw-text",
    description: "detect*Intent helpers must not inspect raw user messages for execution decisions.",
    pattern: /\bdetect[A-Za-z0-9_]*Intent\b/u,
  },
  {
    ruleId: "named-natural-language-pattern",
    description: "Named language regex tables must not determine execution route or executor choice.",
    pattern:
      /\b(?:EXPLICIT_REFERENCE_PATTERNS|SCREEN_CAPTURE_PATTERNS|WINDOW_LIST_PATTERN|FILE_SEND_PATTERN|WEATHER_CURRENT_PATTERN|FINANCE_INDEX_CURRENT_PATTERN|LOCAL_EXECUTION_ACTION_PATTERN|SCHEDULE_MEMORY_REQUEST_PATTERN|TOOL_REQUIRING_TASK_PATTERN|DIRECT_DELIVERY_HINT_PATTERN|DIRECT_DELIVERY_PATTERNS|PHRASE_REPLACEMENTS)\b/u,
  },
  {
    ruleId: "raw-request-includes",
    description: "Raw request/message includes checks must not determine execution semantics.",
    pattern:
      /\b(?:userRequest|originalRequest|rawRequest|requestText|message)\b[\s\S]{0,120}\.includes\s*\(/u,
  },
  {
    ruleId: "locale-lowercase-semantic-match",
    description: "Locale-specific lowercasing is a sign of language-bound semantic matching.",
    pattern: /\.toLocaleLowerCase\("ko-KR"\)/u,
  },
  {
    ruleId: "candidate-string-overlap",
    description: "Candidate scoring by string containment or token overlap must not select executors.",
    pattern:
      /candidateValue\.includes\(normalizedRequired\)|normalizedRequired\.includes\(candidateValue\)|\btokenOverlap\b|\btoken\s+overlap\b|\boverlap\.length\b/u,
  },
  {
    ruleId: "legacy-marker",
    description: "Legacy request_text_match or semantic_topology markers must not return.",
    pattern: /request_text_match|semantic_topology/u,
  },
]

const allowedNonExecutionStringHandling: AllowedNonExecutionStringHandling[] = [
  {
    file: "packages/core/src/orchestration/event-ledger.ts",
    category: "security-redaction",
    reason: "secret and local path redaction protects logs and does not choose an executor or route.",
  },
  {
    file: "packages/core/src/runs/message-ledger.ts",
    category: "security-redaction",
    reason: "secret redaction protects stored messages and does not choose an executor or route.",
  },
  {
    file: "packages/core/src/runs/admin-tool-lab.ts",
    category: "security-redaction",
    reason: "admin diagnostics redact secrets and local paths; they do not dispatch user work.",
  },
  {
    file: "packages/core/src/runs/error-sanitizer.ts",
    category: "security-redaction",
    reason: "error sanitization and coarse error classification operate on system errors, not user intent.",
  },
  {
    file: "packages/core/src/runs/filesystem-verification.ts",
    category: "parser-or-normalizer",
    reason: "filesystem verification parses paths and blocks unsafe filesystem output; it must not select executors.",
  },
  {
    file: "packages/core/src/runs/request-isolation.ts",
    category: "parser-or-normalizer",
    reason: "request isolation checks only structured IntentContract target/action/delivery fields; raw message text is intentionally ignored.",
  },
  {
    file: "packages/core/src/runs/web-retrieval-planner.ts",
    category: "parser-or-normalizer",
    reason: "web retrieval planner validates structured methods and generated value shapes after a route is chosen.",
  },
  {
    file: "packages/core/src/runs/web-source-adapters/weather.ts",
    category: "source-adapter-value-extraction",
    reason: "weather adapter extracts metric values from selected tool results and does not choose a route.",
  },
  {
    file: "packages/core/src/topology/schema.ts",
    category: "parser-or-normalizer",
    reason: "schema helpers validate enum values and do not infer natural-language executor meaning.",
  },
  {
    file: "packages/core/src/topology/validator.ts",
    category: "parser-or-normalizer",
    reason: "topology validator checks graph structure and policy fields after the graph is defined.",
  },
  {
    file: "packages/core/src/orchestration/topology-projection.ts",
    category: "display-only",
    reason: "projection prepares UI/status data and must not choose an executor from raw user text.",
  },
  {
    file: "packages/core/src/orchestration/hierarchy.ts",
    category: "parser-or-normalizer",
    reason: "hierarchy validation checks structured schema issues and relationship ids, not raw user execution intent.",
  },
  {
    file: "packages/core/src/runs/critical-decision-audit.ts",
    category: "display-only",
    reason: "the audit inventory stores forbidden snippets as metadata so tests can track removal targets.",
  },
  {
    file: "packages/core/src/runs/task-model.ts",
    category: "display-only",
    reason: "task monitor model projects run status and delivery labels for UI display after execution decisions exist.",
  },
  {
    file: "packages/core/src/runs/web-location-contract.ts",
    category: "parser-or-normalizer",
    reason: "weather location contract normalizes a selected weather lookup target and does not choose an executor.",
  },
  {
    file: "packages/core/src/runs/web-retrieval-policy.ts",
    category: "parser-or-normalizer",
    reason: "web retrieval policy normalizes structured retrieval contract fields after web retrieval is selected.",
  },
  {
    file: "packages/core/src/runs/web-retrieval-session.ts",
    category: "parser-or-normalizer",
    reason: "web retrieval session normalizes selected retrieval query/session data, not executor routing.",
  },
  {
    file: "packages/core/src/runs/web-retrieval-verification.ts",
    category: "parser-or-normalizer",
    reason: "web retrieval verification compares selected source bindings after retrieval planning.",
  },
  {
    file: "packages/core/src/runs/web-source-adapters/finance.ts",
    category: "source-adapter-value-extraction",
    reason: "finance adapter normalizes market/source values after a finance retrieval source has already been selected.",
  },
  {
    file: "packages/core/src/topology/node-definition-suggestion.ts",
    category: "parser-or-normalizer",
    reason: "node definition suggestion uses structured targetFields and draft fields for UI editing, not runtime executor selection.",
  },
]

function collectFiles(root: string): string[] {
  const absoluteRoot = resolve(process.cwd(), root)
  const entries = readdirSync(absoluteRoot)
  const files: string[] = []

  for (const entry of entries) {
    const absolutePath = join(absoluteRoot, entry)
    const stat = statSync(absolutePath)
    if (stat.isDirectory()) {
      files.push(...collectFiles(relative(process.cwd(), absolutePath)))
      continue
    }
    if (!/\.(ts|js)$/u.test(entry)) continue
    if (/\.d\.ts$/u.test(entry) || /\.test\.ts$/u.test(entry)) continue
    if (entry.endsWith(".js")) continue
    files.push(relative(process.cwd(), absolutePath))
  }

  return files
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b))
}

function findUntrackedForbiddenPatterns(input: {
  files: string[]
  sourceByFile: Map<string, string>
  allowedFiles: Set<string>
  trackedFiles: Set<string>
}): Finding[] {
  const findings: Finding[] = []

  for (const file of input.files) {
    const source = input.sourceByFile.get(file) ?? ""
    const isKnownRemovalTarget = input.trackedFiles.has(file)
    const isAllowedNonExecutionHandling = input.allowedFiles.has(file)

    for (const rule of forbiddenPatternRules) {
      if (!rule.pattern.test(source)) continue
      if (isKnownRemovalTarget || isAllowedNonExecutionHandling) continue
      findings.push({ file, ruleId: rule.ruleId, description: rule.description })
    }
  }

  return findings
}

describe("task022 no keyword execution decision static guard", () => {
  it("keeps allowed non-execution string handling explicit and justified", () => {
    for (const allowed of allowedNonExecutionStringHandling) {
      expect(allowed.file, `${allowed.file} must be a source file path`).toMatch(/^packages\/core\/src\//u)
      expect(allowed.reason.trim(), `${allowed.file} needs a reason`).not.toBe("")
    }
  })

  it("keeps tracked legacy natural-language decision points migration-bound", () => {
    for (const rule of criticalDecisionSourceScanRules) {
      const entry = getCriticalDecisionAuditEntry(rule.entryId)
      expect(entry, `${rule.ruleId} must point to an audit entry`).toBeDefined()
      expect(entry?.file, `${rule.ruleId} should point to the same file as its audit entry`).toBe(rule.file)
      expect(rule.migrationTask, `${rule.ruleId} needs a migration task`).toMatch(/^Task \d{3}(, Task \d{3})*$/u)
      expect(rule.migrationReason.trim(), `${rule.ruleId} needs a migration reason`).not.toBe("")
      expect(entry?.migrationReason?.trim(), `${entry?.id} needs a migration reason`).not.toBe("")
    }
  })

  it("fails an untracked raw-message includes fixture", () => {
    const sourceByFile = new Map([
      [
        "packages/core/src/runs/new-execution-decision.ts",
        `export function choose(userRequest: string) {
          return userRequest.includes("코스피") ? "finance" : "nobie"
        }`,
      ],
    ])

    const findings = findUntrackedForbiddenPatterns({
      files: [...sourceByFile.keys()],
      sourceByFile,
      allowedFiles: new Set(),
      trackedFiles: new Set(),
    })

    expect(findings).toEqual([
      {
        file: "packages/core/src/runs/new-execution-decision.ts",
        ruleId: "raw-request-includes",
        description: "Raw request/message includes checks must not determine execution semantics.",
      },
    ])
  })

  it("does not allow untracked keyword or regex execution decisions in core paths", () => {
    const files = uniqueSorted([
      ...coreDecisionScanRoots.flatMap((root) => collectFiles(root)),
      ...explicitCoreDecisionFiles,
    ])
    const sourceByFile = new Map(files.map((file) => [file, readFileSync(resolve(process.cwd(), file), "utf8")]))
    const trackedFiles = new Set(criticalDecisionSourceScanRules.map((rule) => rule.file))
    const allowedFiles = new Set(allowedNonExecutionStringHandling.map((entry) => entry.file))

    const findings = findUntrackedForbiddenPatterns({
      files,
      sourceByFile,
      allowedFiles,
      trackedFiles,
    })

    expect(findings).toEqual([])
  })
})
