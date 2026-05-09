import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  NODE_DEFINITION_FIELDS,
  EXECUTOR_GRAPH_SOURCE_OF_TRUTH,
  applyNodeDefinitionAlternative,
  buildNodeDefinitionGraphContext,
  buildNodeDefinitionPromptInput,
  buildExampleEnterpriseTopology,
  createNodeDefinitionSuggestion,
  defaultNodeDefinitionFieldLocks,
  fieldLocksForNodeDefinitionTrigger,
  normalizeNodeDefinitionSuggestionRequest,
  redactNodeDefinitionSuggestionRequest,
  type NodeDefinitionDraft,
} from "../packages/core/src/index.ts"
import {
  registerTopologyRoutes,
  resetTopologyGuiDraftStoreForTest,
} from "../packages/core/src/api/routes/topologies.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb } from "../packages/core/src/db/index.js"

const require = createRequire(import.meta.url)
const Fastify = require("../packages/core/node_modules/fastify") as (options: {
  logger: boolean
}) => {
  ready(): Promise<void>
  close(): Promise<void>
  inject(options: {
    method: string
    url: string
    payload?: unknown
  }): Promise<{ statusCode: number; json(): Record<string, unknown> }>
}

const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG
const tempDirs: string[] = []

function draftFixture(overrides: Partial<NodeDefinitionDraft> = {}): NodeDefinitionDraft {
  return {
    executorId: "node:intake",
    name: "접수 담당",
    description: "고객 요청을 읽고 필요한 정보를 확인한다.",
    expectedOutput: "고객 요청 요약",
    successCriteria: ["요청이 분류됨"],
    capabilityHints: ["분석"],
    toolHints: ["tool:crm-search"],
    understandingSummary: "고객 요청을 접수하고 정리",
    fieldLocks: defaultNodeDefinitionFieldLocks(),
    ...overrides,
  }
}

function useTempState(): void {
  closeDb()
  resetTopologyGuiDraftStoreForTest()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task021b-node-definition-"))
  tempDirs.push(stateDir)
  process.env.NOBIE_STATE_DIR = stateDir
  process.env.NOBIE_CONFIG = join(stateDir, "config.json")
  reloadConfig()
}

afterEach(() => {
  closeDb()
  resetTopologyGuiDraftStoreForTest()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
  if (previousStateDir === undefined) delete process.env.NOBIE_STATE_DIR
  else process.env.NOBIE_STATE_DIR = previousStateDir
  if (previousConfig === undefined) delete process.env.NOBIE_CONFIG
  else process.env.NOBIE_CONFIG = previousConfig
  reloadConfig()
})

describe("task021b node definition suggestion contract", () => {
  it("keeps the field list, trigger locks, and quick-chip-only request normalization stable", () => {
    expect(NODE_DEFINITION_FIELDS).toEqual([
      "name",
      "description",
      "expectedOutput",
      "successCriteria",
      "capabilityHints",
      "toolHints",
      "understandingSummary",
    ])

    const nameLocks = fieldLocksForNodeDefinitionTrigger("name")
    expect(nameLocks.name).toBe(false)
    expect(nameLocks.description).toBe(true)

    const descriptionLocks = fieldLocksForNodeDefinitionTrigger("description")
    expect(descriptionLocks.name).toBe(true)
    expect(descriptionLocks.description).toBe(false)

    const normalized = normalizeNodeDefinitionSuggestionRequest({
      triggerField: "whole_node",
      quickChips: ["검토자", "결과 중심으로"],
      currentDraft: draftFixture(),
      fieldLocks: defaultNodeDefinitionFieldLocks({ name: true }),
      graphContext: { incomingExecutors: [], outgoingExecutors: [], neighborConnectionMeanings: [] },
    })
    expect(normalized.userPrompt).toBe("")
    expect(normalized.quickChips).toEqual(["검토자", "결과 중심으로"])
    expect(normalized.targetFields).not.toContain("name")
    expect(normalized.targetFields).toContain("description")
  })

  it("uses the node overview as guidance for detailed description suggestions", async () => {
    const request = normalizeNodeDefinitionSuggestionRequest({
      triggerField: "description",
      targetFields: ["name", "description"],
      userPrompt: "백엔드 이슈를 분석하고 작업을 작게 나눠 다음 담당자에게 넘긴다.",
      quickChips: ["분석자", "꼼꼼하게"],
      currentDraft: draftFixture(),
      fieldLocks: defaultNodeDefinitionFieldLocks(),
      graphContext: {
        incomingExecutors: [{ executorId: "node:prev", name: "접수", description: "요청 접수", direction: "incoming" }],
        outgoingExecutors: [{ executorId: "node:next", name: "구현", description: "작업 구현", direction: "outgoing" }],
        neighborConnectionMeanings: ["넘김"],
      },
    })
    const promptInput = buildNodeDefinitionPromptInput(request)

    expect(promptInput).toContain("노드 개요: 백엔드 이슈를 분석하고 작업을 작게 나눠 다음 담당자에게 넘긴다.")
    expect(promptInput).toContain("선택한 역할: 분석자")
    expect(promptInput).toContain("선택한 스타일: 꼼꼼하게")
    expect(promptInput).toContain("역할명 작성 지침")
    expect(promptInput).toContain("성격과 하는 일 작성 지침")
    expect(promptInput).toContain("5~8문장")
    expect(promptInput).toContain("최종 검토 지침")
    expect(promptInput).toContain("빠진 부분을 보완한 최종 description")

    const result = await createNodeDefinitionSuggestion({
      modelConfig: { provider: "openai", model: "gpt-test" },
      request,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.alternatives).toHaveLength(3)
    expect(result.alternatives[0]!.patch.name).toBe("백엔드 이슈 분석자")
    const description = result.alternatives[0]!.patch.description
    expect(typeof description).toBe("string")
    if (typeof description !== "string") return
    expect(description).toContain("백엔드 이슈")
    expect(description).toContain("분석자")
    expect(description).toContain("꼼꼼하게")
    expect(description).toContain("한 번 더 검토")
    expect(description.length).toBeGreaterThan(180)
    expect(description).toContain("다음 실행자")
    expect(result.alternatives[0]!.rationale).toContain("검토")
  })

  it("adds a clear role name when the model omits patch.name", async () => {
    const result = await createNodeDefinitionSuggestion(
      {
        modelConfig: { provider: "openai", model: "gpt-test" },
        request: {
          workspaceId: "workspace:draft",
          topologyId: "workspace:draft",
          triggerField: "description",
          targetFields: ["name", "description"],
          userPrompt: "프론트엔드 접근성 문제를 검토하고 수정 방향을 정리한다.",
          quickChips: ["검토자", "꼼꼼하게"],
          currentDraft: draftFixture(),
          fieldLocks: defaultNodeDefinitionFieldLocks(),
          graphContext: { incomingExecutors: [], outgoingExecutors: [], neighborConnectionMeanings: [] },
          redaction: { mode: "strict", redactedFields: [] },
          suggestionHistory: [],
        },
      },
      {
        generateStructured: () => ({
          alternatives: [{
            alternativeId: "alternative:test",
            title: "접근성 검토 대안",
            summary: "접근성 문제를 꼼꼼하게 검토합니다.",
            patch: {
              description: "접근성 문제를 기준에 따라 검토하고 수정 방향을 정리합니다.",
            },
            rationale: "설명을 보완했습니다.",
            riskNotes: [],
            confidence: 0.82,
          }],
        }),
      },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.alternatives[0]!.patch.name).toBe("프론트엔드 접근성 검토자")
  })

  it("applies alternatives only to unlocked fields and never clears important fields with empty patches", () => {
    const fieldLocks = defaultNodeDefinitionFieldLocks({ name: true })
    const result = applyNodeDefinitionAlternative({
      executorId: "node:intake",
      alternativeId: "alternative:1",
      draft: draftFixture({ fieldLocks }),
      fieldLocks,
      patch: {
        name: "바뀌면 안 됨",
        description: "요청을 분류하고 다음 담당자에게 넘긴다.",
        expectedOutput: "",
        successCriteria: ["분류 결과가 남음", ""],
        toolHints: ["tool:crm-search", "tool:crm-search"],
      },
    })

    expect(result.draft.name).toBe("접수 담당")
    expect(result.draft.description).toBe("요청을 분류하고 다음 담당자에게 넘긴다.")
    expect(result.draft.expectedOutput).toBe("고객 요청 요약")
    expect(result.draft.successCriteria).toEqual(["분류 결과가 남음"])
    expect(result.ignoredLockedFields).toEqual(["name"])
    expect(result.previousDraft.description).toBe("고객 요청을 읽고 필요한 정보를 확인한다.")
  })

  it("validates LLM alternatives by stripping locked fields, unknown fields, and internal terms", async () => {
    const result = await createNodeDefinitionSuggestion(
      {
        modelConfig: { provider: "openai", model: "gpt-test" },
        request: {
          workspaceId: "workspace:draft",
          topologyId: "workspace:draft",
          triggerField: "whole_node",
          targetFields: ["description", "expectedOutput"],
          userPrompt: "쉽게 정리",
          quickChips: [],
          currentDraft: draftFixture(),
          fieldLocks: defaultNodeDefinitionFieldLocks({ name: true }),
          graphContext: { incomingExecutors: [], outgoingExecutors: [], neighborConnectionMeanings: [] },
          redaction: { mode: "strict", redactedFields: [] },
          suggestionHistory: [],
        },
      },
      {
        idProvider: () => "suggestion:test",
        generateStructured: () => ({
          alternatives: [{
            alternativeId: "alternative:test",
            title: "WorkOrder 검토자",
            summary: "NodeContract 없이 쉽게 설명",
            patch: {
              name: "잠긴 이름",
              description: "사용자가 이해하기 쉬운 실행자",
              expectedOutput: "실행 결과 요약",
              unknownField: "무시",
            },
            rationale: "EnterpriseTopology 표현 제거",
            riskNotes: ["WorkOrder 용어 제거"],
            confidence: 1.4,
          }],
        }),
      },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.suggestionRunId).toBe("suggestion:test")
    expect(result.alternatives).toHaveLength(1)
    expect(result.alternatives[0]!.patch).toEqual({
      description: "사용자가 이해하기 쉬운 실행자",
      expectedOutput: "실행 결과 요약",
    })
    expect(result.alternatives[0]!.title).not.toContain("WorkOrder")
    expect(result.alternatives[0]!.confidence).toBe(1)
    expect(result.warnings.map((warning) => warning.code)).toContain("locked_field_removed")
    expect(result.warnings.map((warning) => warning.code)).toContain("unknown_field_removed")
    expect(result.warnings.map((warning) => warning.code)).toContain("internal_term_removed")
  })

  it("redacts sensitive prompt and neighbor context before provider payload creation", () => {
    const request = normalizeNodeDefinitionSuggestionRequest({
      workspaceId: "workspace:draft",
      topologyId: "workspace:draft",
      triggerField: "whole_node",
      currentDraft: draftFixture({
        description: "secret: sk-test1234567890, /Users/dev/project 를 확인한다.",
      }),
      userPrompt: "담당자 test@example.com, room_id=abc1234",
      graphContext: {
        incomingExecutors: [{
          executorId: "node:prev",
          name: "이전",
          description: "localhost:4220 에서 확인",
          direction: "incoming",
        }],
        outgoingExecutors: [],
        neighborConnectionMeanings: [],
      },
    })
    const redacted = redactNodeDefinitionSuggestionRequest({
      request,
      mode: "workspace_default",
      isLocalModel: false,
    })

    expect(JSON.stringify(redacted.request)).not.toContain("test@example.com")
    expect(JSON.stringify(redacted.request)).not.toContain("/Users/dev/project")
    expect(JSON.stringify(redacted.request)).not.toContain("localhost:4220")
    expect(redacted.report.mode).toBe("strict")
    expect(redacted.report.reasonCodes).toEqual(expect.arrayContaining([
      "absolute_path_redacted",
      "email_redacted",
      "internal_host_redacted",
    ]))
  })

  it("builds compact graph context from only adjacent executor nodes", () => {
    const graphContext = buildNodeDefinitionGraphContext({
      executorId: "node:middle",
      graph: {
        graphId: "graph:test",
        topologyId: "workspace:draft",
        name: "Test graph",
        mode: "simple",
        schemaVersion: 1,
        executors: [
          { ...draftExecutor("node:prev"), name: "접수" },
          { ...draftExecutor("node:middle"), name: "분류" },
          { ...draftExecutor("node:next"), name: "처리" },
        ],
        connections: [
          { id: "edge:1", fromExecutorId: "node:prev", toExecutorId: "node:middle", label: "넘김", relation: "handoff" },
          { id: "edge:2", fromExecutorId: "node:middle", toExecutorId: "node:next", label: "검토 요청", relation: "approval_request" },
        ],
        sections: [],
        selectedId: "node:middle",
        inference: {
          source: "executor_graph_compile",
          confidence: 0.8,
          executorCount: 3,
          connectionCount: 2,
          issueCount: 0,
        },
        compiledPreview: null,
        latestRun: null,
        issues: [],
        sourceOfTruth: EXECUTOR_GRAPH_SOURCE_OF_TRUTH,
      },
    })

    expect(graphContext.incomingExecutors.map((item) => item.name)).toEqual(["접수"])
    expect(graphContext.outgoingExecutors.map((item) => item.name)).toEqual(["처리"])
    expect(graphContext.neighborConnectionMeanings).toEqual(["넘김", "검토 요청"])
  })

  it("returns a friendly API error when no registered LLM is configured", async () => {
    useTempState()
    writeFileSync(process.env.NOBIE_CONFIG!, JSON.stringify({ ai: { connection: { provider: "", model: "" } } }), "utf-8")
    reloadConfig()
    const app = Fastify({ logger: false })
    registerTopologyRoutes(app)
    await app.ready()
    try {
      const topology = { ...buildExampleEnterpriseTopology(Date.UTC(2026, 4, 4, 0, 0, 0)), id: "workspace:draft" }
      const started = await app.inject({
        method: "POST",
        url: "/api/topologies/workspace%3Adraft/gui-draft",
        payload: { topology, reset: true },
      })
      expect(started.statusCode).toBe(201)

      const response = await app.inject({
        method: "POST",
        url: "/api/topologies/workspace%3Adraft/executor-nodes/suggest-definition",
        payload: {
          triggerField: "whole_node",
          targetFields: ["description"],
          currentDraft: draftFixture(),
          fieldLocks: defaultNodeDefinitionFieldLocks(),
          graphContext: { incomingExecutors: [], outgoingExecutors: [], neighborConnectionMeanings: [] },
          userPrompt: "쉽게",
          quickChips: [],
        },
      })
      expect(response.statusCode).toBe(503)
      expect(response.json()).toEqual(expect.objectContaining({
        ok: false,
        error: "llm_not_configured",
      }))
    } finally {
      await app.close()
    }
  })
})

function draftExecutor(id: string) {
  return {
    id,
    name: id,
    description: "업무 처리",
    inferredRuntimeMode: "auto" as const,
    inferredCapabilities: [],
    inferredTools: [],
    inferredOutputs: ["처리 결과"],
    inferredSuccessCriteria: ["완료"],
    confidence: 0.7,
  }
}
