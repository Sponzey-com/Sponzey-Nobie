import { pickUiText, type UiLanguage } from "../stores/uiLanguage"

export type OrchestrationRolloutStageId =
  | "foundation"
  | "dashboard"
  | "studio"
  | "editing"
  | "persist"
  | "accessibility"

export interface OrchestrationRolloutStage {
  id: OrchestrationRolloutStageId
  label: string
  description: string
  requiredBaselines: string[]
}

export interface OrchestrationQaMatrixItem {
  id: string
  label: string
  requiredBaselines: string[]
}

export interface OrchestrationRolloutEvaluation {
  ok: boolean
  completedStages: OrchestrationRolloutStageId[]
  blockedStages: Array<{
    id: OrchestrationRolloutStageId
    missingBaselines: string[]
  }>
  blockerBaselines: string[]
  knownNonBlockers: string[]
}

export function getOrchestrationRolloutStages(language: UiLanguage): OrchestrationRolloutStage[] {
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  return [
    {
      id: "foundation",
      label: t("foundation", "foundation"),
      description: t("theme token, content shell, deterministic avatar, base map node가 준비돼야 합니다.", "Theme tokens, content shell, deterministic avatars, and base map nodes must be ready."),
      requiredBaselines: [
        "task001-orchestration-visual-theme",
        "task001-agent-avatar-render",
        "task001-content-shell-layout",
      ],
    },
    {
      id: "dashboard",
      label: t("dashboard", "dashboard"),
      description: t("dashboard shell, mode switch, pan/zoom, settings preview gate가 고정돼야 합니다.", "Dashboard shell, mode switch, pan/zoom, and settings preview gate must be locked."),
      requiredBaselines: [
        "task002-orchestration-dashboard-shell",
        "task002-orchestration-pan-zoom",
        "task002-orchestration-surface-gate",
        "task003-orchestration-settings-preview",
        "task012-webui-orchestration",
      ],
    },
    {
      id: "studio",
      label: t("studio", "studio"),
      description: t("studio shell, sticky bars, preview-only settings surface가 유지돼야 합니다.", "Studio shell, sticky bars, and the preview-only settings surface must remain intact."),
      requiredBaselines: [
        "task003-orchestration-studio-shell",
        "task003-orchestration-sticky-layout",
        "task008-orchestration-route-surface-matrix",
      ],
    },
    {
      id: "editing",
      label: t("editing", "editing"),
      description: t("drag/drop, popup, parser, quick edit, foldout, legacy overlay가 함께 동작해야 합니다.", "Drag/drop, popup flows, parser, quick edit, foldout, and legacy overlay must work together."),
      requiredBaselines: [
        "task004-orchestration-dnd-intent",
        "task004-orchestration-popup-actions",
        "task005-orchestration-command-parser",
        "task006-orchestration-agent-foldout",
        "task008-orchestration-legacy-overlay",
      ],
    },
    {
      id: "persist",
      label: t("persist", "persist"),
      description: t("validationOnly preflight, ordered persist, partial recovery가 회귀군에 묶여야 합니다.", "validationOnly preflight, ordered persist, and partial recovery must stay in the regression set."),
      requiredBaselines: [
        "task005-orchestration-save-validation",
        "task005-orchestration-partial-persist",
        "task007-orchestration-save-flow",
        "task007-orchestration-partial-recovery",
      ],
    },
    {
      id: "accessibility",
      label: t("accessibility", "accessibility"),
      description: t("keyboard move, shortcut, mobile sheet, topology/Yeonjang visibility가 release gate에 포함돼야 합니다.", "Keyboard move, shortcuts, mobile sheet, and topology/Yeonjang visibility must be part of the release gate."),
      requiredBaselines: [
        "task009-orchestration-keyboard-accessibility",
        "task009-orchestration-shortcuts-mobile",
        "task009-orchestration-rollout-criteria",
        "task009-orchestration-topology-projection",
        "task010-yeonjang-shared-capability",
      ],
    },
  ]
}

export function getOrchestrationQaMatrix(language: UiLanguage): OrchestrationQaMatrixItem[] {
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  return [
    {
      id: "projection_and_shell",
      label: t("projection / shell", "projection / shell"),
      requiredBaselines: [
        "task002-orchestration-board-projection",
        "task002-orchestration-dashboard-shell",
        "task003-orchestration-studio-shell",
      ],
    },
    {
      id: "editing_and_parser",
      label: t("editing / parser", "editing / parser"),
      requiredBaselines: [
        "task004-orchestration-dnd-intent",
        "task004-orchestration-popup-actions",
        "task005-orchestration-command-parser",
        "task005-orchestration-generate-review",
      ],
    },
    {
      id: "persist_and_recovery",
      label: t("persist / recovery", "persist / recovery"),
      requiredBaselines: [
        "task005-orchestration-save-validation",
        "task005-orchestration-partial-persist",
        "task007-orchestration-save-flow",
        "task007-orchestration-partial-recovery",
      ],
    },
    {
      id: "secondary_surfaces",
      label: t("secondary surfaces", "secondary surfaces"),
      requiredBaselines: [
        "task008-orchestration-legacy-overlay",
        "task008-orchestration-route-surface-matrix",
        "task008-orchestration-policy-parity",
        "task009-orchestration-topology-projection",
        "task010-yeonjang-shared-capability",
      ],
    },
    {
      id: "accessibility_and_mobile",
      label: t("accessibility / mobile", "accessibility / mobile"),
      requiredBaselines: [
        "task009-orchestration-keyboard-accessibility",
        "task009-orchestration-shortcuts-mobile",
        "task009-orchestration-rollout-criteria",
      ],
    },
  ]
}

export function evaluateOrchestrationRollout(input: {
  completedBaselines: string[]
  language: UiLanguage
}): OrchestrationRolloutEvaluation {
  const completed = new Set(input.completedBaselines)
  const stages = getOrchestrationRolloutStages(input.language)
  const blockedStages = stages
    .map((stage) => ({
      id: stage.id,
      missingBaselines: stage.requiredBaselines.filter((baseline) => !completed.has(baseline)),
    }))
    .filter((stage) => stage.missingBaselines.length > 0)
  const completedStages = stages
    .filter((stage) => stage.requiredBaselines.every((baseline) => completed.has(baseline)))
    .map((stage) => stage.id)

  return {
    ok: blockedStages.length === 0,
    completedStages,
    blockedStages,
    blockerBaselines: blockedStages.flatMap((stage) => stage.missingBaselines),
    knownNonBlockers: [
      pickUiText(input.language, "Publish placeholder는 아직 backend workflow가 없어도 blocker가 아닙니다.", "The publish placeholder is not a blocker while the backend workflow is still missing."),
      pickUiText(input.language, "Legacy utility surface는 secondary로 남아 있어도 release blocker가 아닙니다.", "Keeping the legacy utility surface as a secondary layer is not a release blocker."),
    ],
  }
}
