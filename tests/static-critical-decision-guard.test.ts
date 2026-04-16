import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  criticalDecisionAuditEntries,
  criticalDecisionSourceScanRules,
  getCriticalDecisionAuditEntry,
} from "../packages/core/src/runs/critical-decision-audit.ts"

const FORBIDDEN_FINAL_SIGNAL_KINDS = new Set([
  "user-natural-language-regex",
  "raw-prompt-ai-comparison",
  "raw-prompt-normalized-dedupe",
])

function readRepoFile(file: string): string {
  return readFileSync(resolve(process.cwd(), file), "utf8")
}

describe("static critical decision guard", () => {
  it("keeps the decision audit inventory well-formed and migration-bound", () => {
    const ids = new Set<string>()

    for (const entry of criticalDecisionAuditEntries) {
      expect(entry.id).toMatch(/^[a-z0-9._-]+$/)
      expect(ids.has(entry.id), `duplicate audit id: ${entry.id}`).toBe(false)
      ids.add(entry.id)
      expect(entry.file).toMatch(/^packages\/core\/src\//)
      expect(entry.symbols.length, `${entry.id} should name at least one symbol`).toBeGreaterThan(0)
      expect(entry.decisionArea.trim(), `${entry.id} should describe a decision area`).not.toBe("")
      expect(entry.currentRole.trim(), `${entry.id} should describe current role`).not.toBe("")
      expect(entry.userFacingRisk.trim(), `${entry.id} should describe user-facing risk`).not.toBe("")

      if (entry.languageSensitive || entry.category === "temporary-guard") {
        expect(entry.migrationTask, `${entry.id} needs a migration task`).toMatch(/^Task \d{3}(, Task \d{3})*$/)
      }

      if (FORBIDDEN_FINAL_SIGNAL_KINDS.has(entry.signalKind)) {
        expect(entry.category, `${entry.id} cannot be a final critical decision`).not.toBe("critical-decision")
      }
    }
  })

  it("marks inventoried source locations in code where source markers are available", () => {
    for (const entry of criticalDecisionAuditEntries) {
      if (!entry.sourceMarker) continue
      const source = readRepoFile(entry.file)
      expect(source, `${entry.file} should contain marker for ${entry.id}`).toContain(entry.sourceMarker)
    }
  })

  it("does not leave source markers without inventory entries", () => {
    const entriesById = new Set(criticalDecisionAuditEntries.map((entry) => entry.id))
    const files = new Set(criticalDecisionAuditEntries.map((entry) => entry.file))
    const markerPattern = /nobie-critical-decision-audit:\s*([a-z0-9._-]+)/g

    for (const file of files) {
      const source = readRepoFile(file)
      for (const match of source.matchAll(markerPattern)) {
        const id = match[1]
        expect(entriesById.has(id), `${file} has unregistered audit marker ${id}`).toBe(true)
      }
    }
  })

  it("keeps known language-sensitive guards inventoried instead of silently adding new final decisions", () => {
    for (const rule of criticalDecisionSourceScanRules) {
      const entry = getCriticalDecisionAuditEntry(rule.entryId)
      expect(entry, `${rule.ruleId} points to a missing audit entry`).toBeDefined()
      expect(entry?.file, `${rule.ruleId} should point to the same file as its entry`).toBe(rule.file)
      expect(entry?.category, `${rule.ruleId} must remain temporary/candidate/display until contract migration`).not.toBe("critical-decision")
      expect(FORBIDDEN_FINAL_SIGNAL_KINDS.has(entry?.signalKind ?? "structured-id-or-key")).toBe(true)

      const source = readRepoFile(rule.file)
      expect(source, `${rule.ruleId} no longer matches source; update the audit inventory before changing guard logic`).toMatch(rule.pattern)
    }
  })

  it("keeps isolated contract comparators free of raw prompt previews", () => {
    const scheduleComparator = readRepoFile("packages/core/src/schedules/comparison.ts")
    expect(scheduleComparator).not.toContain("rawTextPreview")
    expect(scheduleComparator).not.toMatch(/contract\.rawText/u)
    expect(scheduleComparator).not.toMatch(/metadata:\s*candidate\.metadata/u)

    const activeRunComparator = readRepoFile("packages/core/src/runs/entry-comparison.ts")
    expect(activeRunComparator).not.toMatch(/candidate\.prompt/u)
    expect(activeRunComparator).not.toMatch(/run\.prompt/u)
  })

  it("keeps semantic or vector schedule hits as comparison-only candidates", () => {
    const source = readRepoFile("packages/core/src/schedules/candidates.ts")
    const marker = "nobie-critical-decision-audit: schedules.candidates.semantic_candidate_boundary"
    expect(source).toContain(marker)
    const blockStart = source.indexOf(marker)
    const blockEnd = source.indexOf("return [...candidates.values()]", blockStart)
    const semanticBlock = source.slice(blockStart, blockEnd)

    expect(semanticBlock).toContain('candidateReason: "semantic_candidate"')
    expect(semanticBlock).toContain('confidenceKind: "semantic"')
    expect(semanticBlock).toContain("requiresComparison: true")
    expect(semanticBlock).not.toMatch(/confidenceKind:\s*"exact"/u)
    expect(semanticBlock).not.toMatch(/requiresComparison:\s*false/u)
  })
})
