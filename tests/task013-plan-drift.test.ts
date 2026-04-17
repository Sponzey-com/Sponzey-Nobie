import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { parseTaskMetadata, runPlanDriftCheck } from "../packages/core/src/diagnostics/plan-drift.js"
import { runDoctor } from "../packages/core/src/diagnostics/doctor.js"
import { buildReleaseManifest } from "../packages/core/src/release/package.js"

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function createWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), "nobie-task013-plan-drift-"))
  tempDirs.push(root)
  mkdirSync(join(root, ".tasks", "phase001"), { recursive: true })
  mkdirSync(join(root, ".tasks", "phase002"), { recursive: true })
  mkdirSync(join(root, "packages", "core", "src", "diagnostics"), { recursive: true })
  writeFileSync(join(root, "packages", "core", "src", "diagnostics", "plan-drift.ts"), "export {}\n", "utf-8")
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture", version: "0.0.0" }), "utf-8")
  return root
}

function writePhasePlans(root: string): void {
  writeFileSync(join(root, ".tasks", "phase001", "plan.md"), "# Phase 001 Plan\n", "utf-8")
  writeFileSync(join(root, ".tasks", "phase002", "plan.md"), "# Phase 002 Plan\n", "utf-8")
}

function completeTask(extra = ""): string {
  return `# Task 001 - Evidence Fixture

상태: 구현 완료

## 목표
Evidence fixture.

## 기준 문서
- \`.tasks/plan.md\`

## 포함 기능
- [x] Feature.

## 기능 1 - Fixture

### 구현 체크리스트
- [x] Implemented.

### 검증 시나리오
- [x] Verified.

## 자동 테스트
- [x] \`pnpm test tests/task013-plan-drift.test.ts\`

## 수동 smoke
- [x] 해당 없음: 자동 테스트로 검증 완료.

## 완료 조건
- [x] Done.

## 관련 파일 후보
- \`packages/core/src/diagnostics/plan-drift.ts\`

## 롤백 기준
- Warning-only로 낮춘다.
${extra}
`
}

describe("task013 plan drift and evidence checks", () => {
  it("parses task evidence metadata and required sections", () => {
    const metadata = parseTaskMetadata(".tasks/task001.md", completeTask())

    expect(metadata.completed).toBe(true)
    expect(metadata.missingSections).toEqual([])
    expect(metadata.hasAutomatedEvidence).toBe(true)
    expect(metadata.evidenceCommands).toContain("pnpm test tests/task013-plan-drift.test.ts")
  })

  it("warns when phase plans are missing", () => {
    const root = createWorkspace()
    writeFileSync(join(root, ".tasks", "plan.md"), "# Plan\n", "utf-8")
    writeFileSync(join(root, ".tasks", "task001.md"), completeTask(), "utf-8")

    const report = runPlanDriftCheck({ rootDir: root })

    expect(report.phasePlans.filter((plan) => !plan.exists).map((plan) => plan.phase)).toEqual(["phase001", "phase002"])
    expect(report.warnings.map((warning) => warning.code)).toContain("phase_plan_missing")
  })

  it("warns when completed task lacks automated or manual evidence", () => {
    const root = createWorkspace()
    writePhasePlans(root)
    writeFileSync(join(root, ".tasks", "plan.md"), "# Plan\n", "utf-8")
    writeFileSync(join(root, ".tasks", "task001.md"), completeTask().replace("- [x] `pnpm test tests/task013-plan-drift.test.ts`", "- [ ] add test evidence").replace("- [x] 해당 없음: 자동 테스트로 검증 완료.", "- [ ] smoke not run."), "utf-8")

    const report = runPlanDriftCheck({ rootDir: root })

    expect(report.warnings.some((warning) => warning.code === "completed_without_evidence")).toBe(true)
    expect(report.releaseNoteEvidence.unverifiedTasks[0]?.path).toBe(".tasks/task001.md")
  })

  it("warns when referenced paths are missing and detects stale current-plan phase claims", () => {
    const root = createWorkspace()
    writePhasePlans(root)
    writeFileSync(join(root, ".tasks", "plan.md"), "# Plan\n- `.tasks/phase001/plan.md`는 존재하지 않는다.\n", "utf-8")
    writeFileSync(join(root, ".tasks", "task001.md"), completeTask("\n- `packages/core/src/missing-plan-file.ts`\n"), "utf-8")

    const report = runPlanDriftCheck({ rootDir: root })

    expect(report.warnings.some((warning) => warning.code === "missing_referenced_path" && String(warning.detail.reference).includes("missing-plan-file"))).toBe(true)
    expect(report.warnings.some((warning) => warning.code === "plan_outdated_claim")).toBe(true)
  })

  it("separates verified, manual-only, unverified, and pending tasks for release notes", () => {
    const root = createWorkspace()
    writePhasePlans(root)
    writeFileSync(join(root, ".tasks", "plan.md"), "# Plan\n", "utf-8")
    writeFileSync(join(root, ".tasks", "task001.md"), completeTask(), "utf-8")
    writeFileSync(join(root, ".tasks", "task002.md"), completeTask().replace("- [x] `pnpm test tests/task013-plan-drift.test.ts`", "- [ ] manual-only"), "utf-8")
    writeFileSync(join(root, ".tasks", "task003.md"), completeTask().replace("상태: 구현 완료", "상태: 대기").replace("- [x] Done.", "- [ ] Done."), "utf-8")

    const report = runPlanDriftCheck({ rootDir: root })

    expect(report.releaseNoteEvidence.verifiedTasks.map((task) => task.path)).toContain(".tasks/task001.md")
    expect(report.releaseNoteEvidence.manualOnlyTasks.map((task) => task.path)).toContain(".tasks/task002.md")
    expect(report.releaseNoteEvidence.pendingTasks.map((task) => task.path)).toContain(".tasks/task003.md")
  })

  it("exposes plan evidence through doctor and release manifest", () => {
    const doctor = runDoctor({ mode: "quick", includeEnvironment: false, includeReleasePackage: false })
    const release = buildReleaseManifest({ targetPlatforms: [] })

    expect(doctor.checks.some((check) => check.name === "plan.drift")).toBe(true)
    expect(release.planEvidence).toEqual(expect.objectContaining({ warningsByCode: expect.any(Object) }))
    expect(release.pipeline.order).toContain("plan-drift-evidence")
    expect(release.cleanInstallChecklist.some((item) => item.id === "plan-drift")).toBe(true)
  })
})
