import { readFileSync } from "node:fs"
import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import { createExecutorDraftFromInference } from "../packages/webui/src/lib/executor-inference.ts"
import {
  defaultNodeDefinitionFieldLocks,
  nodeDefinitionDraftFromExecutor,
  type NodeDefinitionAlternative,
} from "../packages/webui/src/lib/node-definition-suggestion.ts"
import { ExecutorCreatePanel } from "../packages/webui/src/components/topology/ExecutorCreatePanel.tsx"
import { ExecutorInspector } from "../packages/webui/src/components/topology/ExecutorInspector.tsx"
import { NodeDefinitionAiDialog } from "../packages/webui/src/components/topology/NodeDefinitionAiDialog.tsx"
import { NodeDefinitionAlternativeCard } from "../packages/webui/src/components/topology/NodeDefinitionAlternativeCard.tsx"

const now = Date.UTC(2026, 4, 4, 0, 0, 0)

describe("task021b node definition AI UI", () => {
  it("renders compact AI entry points in the inspector without hiding the manual inputs", () => {
    const executor = createExecutorDraftFromInference({
      id: "node:intake",
      name: "접수 담당",
      description: "고객 요청을 읽고 필요한 정보를 확인한다.",
      now,
    })
    const html = renderToStaticMarkup(
      createElement(ExecutorInspector, {
        executor,
        graph: null,
        workspaceId: "workspace:draft",
        topologyId: "workspace:draft",
      }),
    )

    expect(html).toContain('data-testid="executor-inspector-description-ai"')
    expect(html).not.toContain('data-testid="executor-inspector-ai-refine"')
    expect(html).not.toContain('data-testid="executor-inspector-name-ai"')
    expect(html).not.toContain('data-testid="executor-inspector-expected-output-ai"')
    expect(html).not.toContain('data-testid="executor-inspector-success-criteria-ai"')
    expect(html).toContain('data-testid="executor-inspector-name"')
    expect(html).toContain('data-testid="executor-inspector-description"')
    expect(aiButtonInsideLabel(html, "executor-inspector-description-ai")).toBe(false)
  })

  it("renders the create panel AI entry points before a node is saved", () => {
    const html = renderToStaticMarkup(
      createElement(ExecutorCreatePanel, {
        initialName: "",
        initialDescription: "",
        showCancel: false,
        showDraftButton: false,
        surface: "card",
      }),
    )

    expect(html).toContain('data-testid="executor-create-ai-refine"')
    expect(html).toContain('data-testid="executor-create-description-ai"')
    expect(html).not.toContain('data-testid="executor-create-name-ai"')
    expect(html).toContain('data-testid="executor-create-name"')
    expect(html).toContain('data-testid="executor-create-description"')
    expect(aiButtonInsideLabel(html, "executor-create-description-ai")).toBe(false)
  })

  it("keeps dialog controls, role/style chips, locks, and footer inside the dialog shell", () => {
    const executor = createExecutorDraftFromInference({
      id: "node:review",
      name: "검토자",
      description: "결과를 검토하고 의견을 남긴다.",
      now,
    })
    const draft = {
      ...nodeDefinitionDraftFromExecutor(executor),
      quickChips: ["검토자", "꼼꼼하게"],
    }
    const html = renderToStaticMarkup(
      createElement(NodeDefinitionAiDialog, {
        open: true,
        workspaceId: "workspace:draft",
        topologyId: "workspace:draft",
        draft,
        graphContext: { incomingExecutors: [], outgoingExecutors: [], neighborConnectionMeanings: [] },
        triggerField: "description",
        onClose: () => undefined,
        onApply: () => undefined,
      }),
    )

    expect(html).toContain('role="dialog"')
    expect(html).toContain('max-h-[calc(100vh-32px)]')
    expect(html).not.toContain('data-testid="node-definition-dialog-prompt"')
    expect(html).not.toContain("원하는 방향")
    expect(html).toContain('data-testid="node-definition-overview-section"')
    expect(html).toContain('data-testid="node-definition-dialog-overview"')
    expect(html).toContain("노드 개요")
    expect(html).toContain("성격과 하는 일로 확장")
    expect(html).toContain('data-testid="node-definition-quick-chip"')
    expect(html).toContain("실행자")
    expect(html).toContain("결과 중심으로")
    expect(chipPressed(html, "검토자")).toBe(true)
    expect(chipPressed(html, "꼼꼼하게")).toBe(true)
    expect(chipPressed(html, "실행자")).toBe(false)
    expect(html).not.toContain("산출물")
    expect(html).not.toContain("구현 결과")
    expect(html).not.toContain("바꿀 항목과 유지할 항목")
    expect(html).not.toContain('data-testid="node-definition-dialog-fields"')
    expect(html).not.toContain('data-testid="node-field-lock-toggle"')
    expect(html).not.toContain('data-testid="node-definition-target-field"')
    expect(html).toContain("성격과 하는 일")
    expect(html).not.toContain("예상 결과")
    expect(html).not.toContain("성공 기준")
    expect(html).toContain('data-testid="node-definition-dialog-save"')
    expect(html).toContain("저장")
    expect(html).toContain('data-testid="node-definition-dialog-submit"')
    expect(html).toContain("제안 받기")
    expect(html).toContain("이름과 성격과 하는 일 갱신 가능")
  })

  it("shows alternative cards with locked fields marked as retained and selectable", () => {
    const draft = nodeDefinitionDraftFromExecutor(createExecutorDraftFromInference({
      id: "node:review",
      name: "검토자",
      description: "결과를 검토한다.",
      now,
    }))
    const alternative: NodeDefinitionAlternative = {
      alternativeId: "alternative:1",
      title: "품질형 검토자",
      summary: "결과 품질을 꼼꼼하게 확인합니다.",
      patch: {
        name: "품질 검토자",
        description: "결과 품질을 확인하고 보완 의견을 남긴다.",
        expectedOutput: "검토 의견",
        successCriteria: ["보완점이 정리됨"],
      },
      rationale: "사용자 설명을 더 구체화했습니다.",
      recommendedConnectionMeaning: "검토 요청",
      riskNotes: ["불명확한 기준은 최종 검토에서 확인"],
      confidence: 0.81,
    }
    const html = renderToStaticMarkup(
      createElement(NodeDefinitionAlternativeCard, {
        alternative,
        currentDraft: draft,
        fieldLocks: defaultNodeDefinitionFieldLocks(),
        onSelect: () => undefined,
      }),
    )

    expect(html).toContain('data-testid="node-definition-alternative-card"')
    expect(html).toContain("품질형 검토자")
    expect(html).toContain('data-testid="node-definition-role-name-badge"')
    expect(html).toContain("역할명")
    expect(html).toContain("이름")
    expect(html).toContain("품질 검토자")
    expect(html).toContain("추천 연결 방식")
    expect(html).toContain("이 대안 적용")
  })

  it("lays out AI alternatives as tabs with one full-width content panel", () => {
    const dialogSource = readFileSync("packages/webui/src/components/topology/NodeDefinitionAiDialog.tsx", "utf8")
    const cardSource = readFileSync("packages/webui/src/components/topology/NodeDefinitionAlternativeCard.tsx", "utf8")

    expect(dialogSource).toContain('data-testid="node-definition-alternative-list"')
    expect(dialogSource).toContain('role="tablist"')
    expect(dialogSource).toContain('role="tab"')
    expect(dialogSource).toContain('data-testid="node-definition-alternative-tab"')
    expect(dialogSource).toContain('role="tabpanel"')
    expect(dialogSource).toContain('data-testid="node-definition-alternative-panel"')
    expect(dialogSource).toContain('["name", "description"]')
    expect(dialogSource).toContain("userPrompt: promptText")
    expect(dialogSource).toContain('data-testid="node-definition-dialog-overview"')
    expect(dialogSource).toContain("overflow-x-auto")
    expect(dialogSource).not.toContain("snap-x")
    expect(cardSource).toContain("w-full")
    expect(cardSource).toContain("min-w-0")
    expect(cardSource).toContain('data-testid="node-definition-role-name-badge"')
    expect(cardSource).not.toContain("shrink-0")
    expect(cardSource).not.toContain("snap-start")
    expect(cardSource).toContain("whitespace-pre-wrap")
    expect(cardSource).not.toContain("line-clamp-2")
    expect(cardSource).not.toContain("line-clamp-3")
  })
})

function chipPressed(html: string, chip: string): boolean {
  const target = `>${chip}</button>`
  const index = html.indexOf(target)
  if (index < 0) return false
  const before = html.slice(Math.max(0, index - 260), index)
  return before.includes('aria-pressed="true"')
}

function aiButtonInsideLabel(html: string, testId: string): boolean {
  const target = `data-testid="${testId}"`
  return html
    .split("<label")
    .slice(1)
    .some((chunk) => {
      const labelMarkup = chunk.split("</label>")[0] ?? ""
      return labelMarkup.includes(target)
    })
}
