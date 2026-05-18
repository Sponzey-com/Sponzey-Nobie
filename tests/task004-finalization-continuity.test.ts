import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb, getTaskContinuity, insertSession } from "../packages/core/src/db/index.js"
import {
  rememberRunAwaitingUser,
  rememberRunFailure,
  rememberRunInstruction,
  rememberRunSuccess,
} from "../packages/core/src/runs/start-support.ts"
import { createRootRun } from "../packages/core/src/runs/store.ts"

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task004-continuity-"))
  tempDirs.push(stateDir)
  process.env["NOBIE_STATE_DIR"] = stateDir
  delete process.env["NOBIE_CONFIG"]
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
  reloadConfig()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("task004 finalization continuity", () => {
  it("persists latest instruction, target context, recovery hints, and latest success summary", () => {
    insertSession({
      id: "session:task004",
      source: "webui",
      source_id: null,
      created_at: 1,
      updated_at: 1,
      summary: null,
    })
    createRootRun({
      id: "run:task004",
      sessionId: "session:task004",
      requestGroupId: "group:task004",
      prompt: "이전 초안을 보강해.",
      source: "webui",
      targetId: "agent:researcher",
      targetLabel: "Researcher",
      workerRuntimeKind: "agent",
      handoffSummary: "부모 요약",
    })

    rememberRunInstruction({
      runId: "run:task004",
      sessionId: "session:task004",
      requestGroupId: "group:task004",
      source: "webui",
      message: "새 인용을 추가하고 기존 구조는 유지해.",
    })
    rememberRunFailure({
      runId: "run:task004",
      sessionId: "session:task004",
      source: "webui",
      summary: "근거가 부족해 멈췄다.",
      detail: "answer output에 source 근거가 없다.",
      title: "required_evidence_missing",
    })
    rememberRunAwaitingUser({
      runId: "run:task004",
      sessionId: "session:task004",
      source: "webui",
      summary: "추가 입력이 필요하다.",
      reason: "대상 범위가 모호하다.",
      userMessage: "어느 문단을 우선 수정할지 알려 달라.",
      remainingItems: ["우선순위 지정"],
    })
    rememberRunSuccess({
      runId: "run:task004",
      sessionId: "session:task004",
      source: "webui",
      text: "수정 완료",
      summary: "인용을 추가해 수정 완료",
    })

    expect(getTaskContinuity("group:task004")).toMatchObject({
      lineageRootRunId: "group:task004",
      handoffSummary: "새 인용을 추가하고 기존 구조는 유지해.",
      latestInstructionSummary: "새 인용을 추가하고 기존 구조는 유지해.",
      latestSuccessfulSummary: "인용을 추가해 수정 완료",
      latestTargetContext: expect.stringContaining("Researcher"),
      failureRecoveryHints: expect.arrayContaining([
        "대상 범위가 모호하다.",
        "어느 문단을 우선 수정할지 알려 달라.",
        "우선순위 지정",
      ]),
    })
  })

  it("keeps empty continuity exchange refs and pending arrays stable on read", () => {
    insertSession({
      id: "session:task004:empty",
      source: "webui",
      source_id: null,
      created_at: 1,
      updated_at: 1,
      summary: null,
    })
    createRootRun({
      id: "run:task004:empty",
      sessionId: "session:task004:empty",
      requestGroupId: "group:task004:empty",
      prompt: "빈 상태 확인",
      source: "webui",
    })
    rememberRunInstruction({
      runId: "run:task004:empty",
      sessionId: "session:task004:empty",
      requestGroupId: "group:task004:empty",
      source: "webui",
      message: "요약만 저장",
    })

    expect(getTaskContinuity("group:task004:empty")).toMatchObject({
      continuityExchangeRefs: [],
      pendingApprovals: [],
      pendingDelivery: [],
    })
  })
})
