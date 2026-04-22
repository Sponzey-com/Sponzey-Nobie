import { describe, expect, it } from "vitest"
import {
  evaluateOrchestrationRollout,
  getOrchestrationQaMatrix,
  getOrchestrationRolloutStages,
} from "../packages/webui/src/lib/orchestration-rollout.ts"

describe("task009 orchestration rollout criteria", () => {
  it("defines rollout stages from foundation through accessibility", () => {
    const stages = getOrchestrationRolloutStages("en")

    expect(stages.map((stage) => stage.id)).toEqual([
      "foundation",
      "dashboard",
      "studio",
      "editing",
      "persist",
      "accessibility",
    ])
    expect(stages.find((stage) => stage.id === "accessibility")?.requiredBaselines).toEqual(expect.arrayContaining([
      "task009-orchestration-keyboard-accessibility",
      "task009-orchestration-shortcuts-mobile",
      "task009-orchestration-rollout-criteria",
      "task009-orchestration-topology-projection",
      "task010-yeonjang-shared-capability",
    ]))
  })

  it("connects the QA matrix to shell, editing, persist, secondary surface, and accessibility baselines", () => {
    const matrix = getOrchestrationQaMatrix("en")

    expect(matrix.map((item) => item.id)).toEqual([
      "projection_and_shell",
      "editing_and_parser",
      "persist_and_recovery",
      "secondary_surfaces",
      "accessibility_and_mobile",
    ])
    expect(matrix.find((item) => item.id === "secondary_surfaces")?.requiredBaselines).toEqual(expect.arrayContaining([
      "task008-orchestration-legacy-overlay",
      "task008-orchestration-route-surface-matrix",
      "task009-orchestration-topology-projection",
      "task010-yeonjang-shared-capability",
    ]))
  })

  it("blocks rollout until accessibility baselines are complete and passes once they are included", () => {
    const blocked = evaluateOrchestrationRollout({
      language: "en",
      completedBaselines: [
        "task001-orchestration-visual-theme",
        "task001-agent-avatar-render",
        "task001-content-shell-layout",
        "task002-orchestration-dashboard-shell",
        "task002-orchestration-pan-zoom",
        "task002-orchestration-surface-gate",
        "task003-orchestration-settings-preview",
        "task012-webui-orchestration",
        "task003-orchestration-studio-shell",
        "task003-orchestration-sticky-layout",
        "task008-orchestration-route-surface-matrix",
        "task004-orchestration-dnd-intent",
        "task004-orchestration-popup-actions",
        "task005-orchestration-command-parser",
        "task006-orchestration-agent-foldout",
        "task008-orchestration-legacy-overlay",
        "task005-orchestration-save-validation",
        "task005-orchestration-partial-persist",
        "task007-orchestration-save-flow",
        "task007-orchestration-partial-recovery",
      ],
    })

    expect(blocked.ok).toBe(false)
    expect(blocked.blockedStages.find((stage) => stage.id === "accessibility")?.missingBaselines).toEqual(expect.arrayContaining([
      "task009-orchestration-keyboard-accessibility",
      "task009-orchestration-shortcuts-mobile",
      "task009-orchestration-rollout-criteria",
      "task009-orchestration-topology-projection",
      "task010-yeonjang-shared-capability",
    ]))

    const ready = evaluateOrchestrationRollout({
      language: "en",
      completedBaselines: [
        ...blocked.completedStages.flatMap((stageId) => getOrchestrationRolloutStages("en").find((stage) => stage.id === stageId)?.requiredBaselines ?? []),
        "task001-orchestration-visual-theme",
        "task001-agent-avatar-render",
        "task001-content-shell-layout",
        "task002-orchestration-dashboard-shell",
        "task002-orchestration-pan-zoom",
        "task002-orchestration-surface-gate",
        "task003-orchestration-settings-preview",
        "task012-webui-orchestration",
        "task003-orchestration-studio-shell",
        "task003-orchestration-sticky-layout",
        "task008-orchestration-route-surface-matrix",
        "task004-orchestration-dnd-intent",
        "task004-orchestration-popup-actions",
        "task005-orchestration-command-parser",
        "task006-orchestration-agent-foldout",
        "task008-orchestration-legacy-overlay",
        "task005-orchestration-save-validation",
        "task005-orchestration-partial-persist",
        "task007-orchestration-save-flow",
        "task007-orchestration-partial-recovery",
        "task009-orchestration-keyboard-accessibility",
        "task009-orchestration-shortcuts-mobile",
        "task009-orchestration-rollout-criteria",
        "task009-orchestration-topology-projection",
        "task010-yeonjang-shared-capability",
      ],
    })

    expect(ready.ok).toBe(true)
    expect(ready.blockedStages).toEqual([])
    expect(ready.completedStages).toEqual([
      "foundation",
      "dashboard",
      "studio",
      "editing",
      "persist",
      "accessibility",
    ])
    expect(ready.knownNonBlockers).toHaveLength(2)
  })
})
