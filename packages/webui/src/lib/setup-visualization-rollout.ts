import { pickUiText, type UiLanguage } from "../stores/uiLanguage"

export type SetupVisualizationFeatureMode =
  | "topology_off"
  | "topology_read_only"
  | "topology_editable_experimental"

export type SetupVisualizationRuntimeState =
  | "single_nobie"
  | "orchestration"
  | "no_connected_runtime"
  | "runtime_ready"

export type SetupVisualizationViewportId =
  | "desktop_wide"
  | "laptop_1280"
  | "tablet_mobile_fallback"

export type SetupVisualizationRolloutStageId =
  | "foundation"
  | "step_coverage"
  | "parity"
  | "topology"
  | "review_qa"

export interface SetupVisualizationViewportDefinition {
  id: SetupVisualizationViewportId
  label: string
  width: number
  height: number
  shellMode: "three_column" | "compact_canvas" | "drawer_sheet_fallback"
  requiredShellFeatures: string[]
  protectedByTests: string[]
}

export interface SetupVisualizationBaselineScreen {
  sceneId: string
  label: string
  surface: "setup" | "orchestration"
  comparableModes: Array<"beginner" | "advanced">
  requiredViewportIds: SetupVisualizationViewportId[]
  captureStates: string[]
  protectedByTests: string[]
}

export interface SetupVisualizationQaScenario {
  id: string
  label: string
  description: string
  featureModes: SetupVisualizationFeatureMode[]
  runtimeStates: SetupVisualizationRuntimeState[]
  requiredBaselines: string[]
}

export interface SetupVisualizationFallbackMode {
  mode: SetupVisualizationFeatureMode
  label: string
  description: string
  fallbackSurfaces: string[]
}

export interface SetupVisualizationReleaseChecklistItem {
  id: string
  label: string
  description: string
  required: boolean
}

export interface SetupVisualizationRolloutStage {
  id: SetupVisualizationRolloutStageId
  label: string
  description: string
  requiredTaskIds: string[]
  requiredTestBaselines: string[]
  acceptanceCriteria: string[]
}

export interface SetupVisualizationRolloutGateResult {
  status: "ready" | "blocked"
  completedStageIds: SetupVisualizationRolloutStageId[]
  blockedStages: Array<{
    stageId: SetupVisualizationRolloutStageId
    missingTaskIds: string[]
    missingTestBaselines: string[]
  }>
  fallbackModes: SetupVisualizationFallbackMode[]
  releaseChecklist: SetupVisualizationReleaseChecklistItem[]
}

export function getSetupVisualizationViewportMatrix(language: UiLanguage): SetupVisualizationViewportDefinition[] {
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  return [
    {
      id: "desktop_wide",
      label: t("desktop wide", "desktop wide"),
      width: 1440,
      height: 1024,
      shellMode: "three_column",
      requiredShellFeatures: ["left_rail", "xl_inspector", "fixed_footer", "legend_canvas_content"],
      protectedByTests: ["task001-setup-visualization", "task008-setup-ux-accessibility"],
    },
    {
      id: "laptop_1280",
      label: t("1280급 노트북", "1280-class laptop"),
      width: 1280,
      height: 900,
      shellMode: "compact_canvas",
      requiredShellFeatures: ["fixed_footer", "legend_canvas_content", "single_scroll_surface"],
      protectedByTests: ["task001-setup-visualization", "task008-setup-ux-accessibility", "task016-ui-performance-accessibility"],
    },
    {
      id: "tablet_mobile_fallback",
      label: t("tablet/mobile fallback", "tablet/mobile fallback"),
      width: 768,
      height: 1024,
      shellMode: "drawer_sheet_fallback",
      requiredShellFeatures: ["mobile_steps_toggle", "inspector_drawer", "inspector_sheet", "no_xl_sidebar_overlap"],
      protectedByTests: ["task008-setup-ux-accessibility", "task016-ui-performance-accessibility"],
    },
  ]
}

export function getSetupVisualizationBaselineScreens(language: UiLanguage): SetupVisualizationBaselineScreen[] {
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  const sharedViewports: SetupVisualizationViewportId[] = ["desktop_wide", "laptop_1280", "tablet_mobile_fallback"]
  return [
    {
      sceneId: "scene:welcome",
      label: t("welcome", "welcome"),
      surface: "setup",
      comparableModes: ["beginner", "advanced"],
      requiredViewportIds: sharedViewports,
      captureStates: ["default", "selected_node"],
      protectedByTests: ["task002-setup-visualization-projection", "task003-setup-welcome-personal", "task008-setup-ux-accessibility"],
    },
    {
      sceneId: "scene:ai_backends",
      label: t("ai_backends", "ai_backends"),
      surface: "setup",
      comparableModes: ["beginner", "advanced"],
      requiredViewportIds: sharedViewports,
      captureStates: ["default", "selected_backend", "inspector_open"],
      protectedByTests: ["task004-ai-visualization-topology", "task008-setup-ux-accessibility"],
    },
    {
      sceneId: "scene:mcp",
      label: "mcp",
      surface: "setup",
      comparableModes: ["advanced"],
      requiredViewportIds: sharedViewports,
      captureStates: ["default", "validation_overlay", "inspector_open"],
      protectedByTests: ["task005-mcp-skills-capability-map", "task008-setup-ux-accessibility"],
    },
    {
      sceneId: "scene:skills",
      label: "skills",
      surface: "setup",
      comparableModes: ["advanced"],
      requiredViewportIds: sharedViewports,
      captureStates: ["default", "selected_node", "validation_overlay"],
      protectedByTests: ["task005-mcp-skills-capability-map", "task008-setup-ux-accessibility"],
    },
    {
      sceneId: "scene:channels",
      label: "channels",
      surface: "setup",
      comparableModes: ["beginner", "advanced"],
      requiredViewportIds: sharedViewports,
      captureStates: ["default", "runtime_warning", "inspector_open"],
      protectedByTests: ["task006-security-channels-visualization", "task008-setup-ux-accessibility"],
    },
    {
      sceneId: "scene:review",
      label: "review",
      surface: "setup",
      comparableModes: ["beginner", "advanced"],
      requiredViewportIds: sharedViewports,
      captureStates: ["default", "drill_down_selected"],
      protectedByTests: ["task007-remote-review-done", "task008-setup-ux-accessibility"],
    },
    {
      sceneId: "scene:orchestration_topology",
      label: t("sub-agent topology", "sub-agent topology"),
      surface: "orchestration",
      comparableModes: ["beginner", "advanced"],
      requiredViewportIds: sharedViewports,
      captureStates: ["default", "selected_node", "yeonjang_relation_selected", "inspector_open"],
      protectedByTests: ["task009-orchestration-topology-projection", "task010-yeonjang-shared-capability", "task012-webui-orchestration"],
    },
  ]
}

export function getSetupVisualizationQaChecklist(language: UiLanguage): SetupVisualizationQaScenario[] {
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  return [
    {
      id: "save_cancel_revert",
      label: t("저장/취소/되돌리기", "Save / cancel / revert"),
      description: t(
        "localDraft 기반 setup 저장 의미가 유지되고, 취소 시 Inspector와 scene 상태가 함께 되돌아가야 한다.",
        "The localDraft-based setup save semantics must remain intact, and cancel must revert both the inspector and the scene state.",
      ),
      featureModes: ["topology_off", "topology_read_only", "topology_editable_experimental"],
      runtimeStates: ["single_nobie", "orchestration"],
      requiredBaselines: ["task001-setup-visualization", "task006-beginner-setup", "task007-advanced-ui"],
    },
    {
      id: "validation_next_lock",
      label: t("validation / next-step lock", "Validation / next-step lock"),
      description: t(
        "validation overlay, blocked-next-step, readiness 보드 이동이 동시에 깨지지 않아야 한다.",
        "Validation overlays, blocked-next-step state, and readiness-board navigation must stay consistent together.",
      ),
      featureModes: ["topology_off", "topology_read_only", "topology_editable_experimental"],
      runtimeStates: ["single_nobie", "orchestration"],
      requiredBaselines: ["task003-setup-welcome-personal", "task007-remote-review-done", "task008-setup-ux-accessibility"],
    },
    {
      id: "review_done_completion",
      label: t("review / done completion", "Review / done completion"),
      description: t(
        "review drill-down과 done summary는 runtime 미연결 상태에서도 empty state나 warning으로 끝나야 하며 비정상 종료되면 안 된다.",
        "Review drill-down and done summary must degrade to empty or warning states when runtime is unavailable, without crashing the UI.",
      ),
      featureModes: ["topology_off", "topology_read_only", "topology_editable_experimental"],
      runtimeStates: ["no_connected_runtime", "runtime_ready"],
      requiredBaselines: ["task007-remote-review-done", "task016-ui-performance-accessibility"],
    },
    {
      id: "keyboard_and_accessibility",
      label: t("keyboard / accessibility", "Keyboard / accessibility"),
      description: t(
        "keyboard-only 탐색, screen reader용 text outline, drawer/sheet focus 이동, status badge text가 유지돼야 한다.",
        "Keyboard-only navigation, text outlines for screen readers, drawer/sheet focus transitions, and text status badges must remain intact.",
      ),
      featureModes: ["topology_off", "topology_read_only", "topology_editable_experimental"],
      runtimeStates: ["single_nobie", "runtime_ready"],
      requiredBaselines: ["task008-setup-ux-accessibility", "task016-ui-performance-accessibility"],
    },
    {
      id: "topology_feature_modes",
      label: t("topology feature modes", "Topology feature modes"),
      description: t(
        "topology off, read-only, editable experimental 세 모드가 같은 route에서 soft gate로 일관되게 동작해야 한다.",
        "The topology off, read-only, and editable experimental modes must behave consistently as soft gates on the same route.",
      ),
      featureModes: ["topology_off", "topology_read_only", "topology_editable_experimental"],
      runtimeStates: ["single_nobie", "orchestration", "no_connected_runtime", "runtime_ready"],
      requiredBaselines: ["task009-orchestration-topology-projection", "task010-yeonjang-shared-capability", "task015-ui-route-migration", "task012-webui-orchestration"],
    },
  ]
}

export function getSetupVisualizationFallbackModes(language: UiLanguage): SetupVisualizationFallbackMode[] {
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  return [
    {
      mode: "topology_off",
      label: t("topology off", "topology off"),
      description: t(
        "Visualization-first surface를 rollout에서 내릴 때는 기존 form 중심 setup과 settings 탭 구성을 안전 fallback으로 유지한다.",
        "When the visualization-first surface is rolled back, the existing form-first setup and settings surfaces remain the safe fallback.",
      ),
      fallbackSurfaces: ["SetupPage form flow", "SettingsPage agents tab preview", "RelationshipGraphPanel", "AdvancedEditor"],
    },
    {
      mode: "topology_read_only",
      label: t("topology read-only", "topology read-only"),
      description: t(
        "토폴로지는 계속 보이지만 편집 affordance와 write API는 잠기며, disabled notice와 preview entry만 남긴다.",
        "The topology remains visible, but edit affordances and write APIs are locked, leaving only disabled notices and preview entry points.",
      ),
      fallbackSurfaces: ["Read-only topology projection", "Disabled editor notice", "Import/export locked state"],
    },
    {
      mode: "topology_editable_experimental",
      label: t("topology editable experimental", "topology editable experimental"),
      description: t(
        "편집이 허용될 때도 기존 onboarding draft와 분리된 orchestration surface에서만 validate/save/import가 열린다.",
        "Even when editing is enabled, validate/save/import stay limited to the orchestration surface that is separated from the onboarding draft.",
      ),
      fallbackSurfaces: ["OrchestrationControlPanel write actions", "Import/export validation", "Yeonjang soft gate inspector"],
    },
  ]
}

export function getSetupVisualizationReleaseChecklist(language: UiLanguage): SetupVisualizationReleaseChecklistItem[] {
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  return [
    {
      id: "layout_stability",
      label: t("레이아웃 안정성", "Layout stability"),
      description: t("핵심 7개 기준 화면이 3개 viewport에서 구조적으로 유지돼야 한다.", "The seven baseline screens must remain structurally stable across three viewports."),
      required: true,
    },
    {
      id: "accessibility",
      label: t("접근성 fallback", "Accessibility fallback"),
      description: t("keyboard-only, text outline, drawer/sheet focus 이동, status text label이 유지돼야 한다.", "Keyboard-only flow, text outline, drawer/sheet focus movement, and text status labels must remain intact."),
      required: true,
    },
    {
      id: "performance",
      label: t("성능 예산", "Performance budget"),
      description: t("critical API budget, list window, fallback viewport에서의 렌더링 예산이 유지돼야 한다.", "The critical API budget, list windowing, and fallback-viewport rendering budget must be preserved."),
      required: true,
    },
    {
      id: "feature_gate_consistency",
      label: t("feature gate 일관성", "Feature-gate consistency"),
      description: t("UI 노출, route entry, API write path, disabled notice가 같은 mode semantics를 따라야 한다.", "UI exposure, route entry, API write paths, and disabled notices must follow the same mode semantics."),
      required: true,
    },
    {
      id: "automated_regressions",
      label: t("자동 회귀 통과", "Automated regressions"),
      description: t("foundation, parity, topology, review/qa baseline 테스트가 모두 통과해야 한다.", "The foundation, parity, topology, and review/QA baseline tests must all pass."),
      required: true,
    },
  ]
}

export function getSetupVisualizationRolloutStages(language: UiLanguage): SetupVisualizationRolloutStage[] {
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  return [
    {
      id: "foundation",
      label: t("foundation", "foundation"),
      description: t("공통 scene 계약, shell, overlay, responsive inspector 기반을 고정한다.", "Locks the common scene contract, shell, overlays, and responsive inspector foundation."),
      requiredTaskIds: ["task001", "task008"],
      requiredTestBaselines: ["task001-setup-visualization", "task008-setup-ux-accessibility"],
      acceptanceCriteria: [
        t("시각화 계약과 shell 확장이 저장 의미를 깨지 않는다.", "The visualization contract and shell extension do not break save semantics."),
        t("drawer/sheet fallback이 viewport 축소에서도 유지된다.", "Drawer/sheet fallback remains intact as the viewport narrows."),
      ],
    },
    {
      id: "step_coverage",
      label: t("step coverage", "step coverage"),
      description: t("setup 주요 단계가 모두 시각화 scene으로 덮여야 한다.", "All major setup steps must be covered by visualization scenes."),
      requiredTaskIds: ["task003", "task004", "task005", "task006", "task007"],
      requiredTestBaselines: [
        "task003-setup-welcome-personal",
        "task004-ai-visualization-topology",
        "task005-mcp-skills-capability-map",
        "task006-security-channels-visualization",
        "task007-remote-review-done",
      ],
      acceptanceCriteria: [
        t("welcome, AI, MCP, skills, channels, review가 모두 기준 scene으로 존재한다.", "Welcome, AI, MCP, skills, channels, and review all exist as baseline scenes."),
        t("review와 done은 readiness 기준과 연결된다.", "Review and done stay aligned with readiness criteria."),
      ],
    },
    {
      id: "parity",
      label: t("parity", "parity"),
      description: t("초보/고급 모드가 같은 의미 체계를 공유하고, route migration이 안전해야 한다.", "Beginner and advanced modes must share the same semantics, and route migration must remain safe."),
      requiredTaskIds: ["task002"],
      requiredTestBaselines: ["task002-setup-visualization-projection", "task006-beginner-setup", "task007-advanced-ui", "task015-ui-route-migration"],
      acceptanceCriteria: [
        t("초보/고급 차이는 정보 밀도이지 의미 차이가 아니다.", "The difference between beginner and advanced is information density, not semantics."),
        t("rollback 또는 soft gate가 route blank state 없이 동작한다.", "Rollback or soft gates work without leaving routes blank."),
      ],
    },
    {
      id: "topology",
      label: t("topology", "topology"),
      description: t("서브 에이전트 topology와 Yeonjang shared capability gate를 고정한다.", "Locks the sub-agent topology and the Yeonjang shared-capability gate."),
      requiredTaskIds: ["task009", "task010"],
      requiredTestBaselines: ["task009-orchestration-topology-projection", "task010-yeonjang-shared-capability", "task012-webui-orchestration"],
      acceptanceCriteria: [
        t("topology는 onboarding draft와 분리된 read-only 또는 soft-gated surface다.", "The topology is a read-only or soft-gated surface that stays separate from the onboarding draft."),
        t("Yeonjang은 shared capability hub로만 표현된다.", "Yeonjang is represented only as a shared capability hub."),
      ],
    },
    {
      id: "review_qa",
      label: t("review / qa", "review / qa"),
      description: t("시각 회귀, QA 시나리오, release checklist가 rollout stop condition으로 고정된다.", "Visual regressions, QA scenarios, and the release checklist become rollout stop conditions."),
      requiredTaskIds: ["task011"],
      requiredTestBaselines: ["task011-setup-visualization-rollout", "task016-ui-performance-accessibility"],
      acceptanceCriteria: [
        t("핵심 7개 기준 화면과 3개 viewport가 source of truth로 고정된다.", "The seven baseline screens and three viewports are locked as source-of-truth baselines."),
        t("성능, 접근성, feature gate 일관성이 release checklist에 포함된다.", "Performance, accessibility, and feature-gate consistency are part of the release checklist."),
      ],
    },
  ]
}

export function buildSetupVisualizationRolloutGate(input: {
  completedTaskIds: string[]
  availableTestBaselines: string[]
  language: UiLanguage
}): SetupVisualizationRolloutGateResult {
  const completedTaskIds = new Set(input.completedTaskIds)
  const availableTestBaselines = new Set(input.availableTestBaselines)
  const stages = getSetupVisualizationRolloutStages(input.language)
  const blockedStages = stages
    .map((stage) => ({
      stageId: stage.id,
      missingTaskIds: stage.requiredTaskIds.filter((taskId) => !completedTaskIds.has(taskId)),
      missingTestBaselines: stage.requiredTestBaselines.filter((testId) => !availableTestBaselines.has(testId)),
    }))
    .filter((stage) => stage.missingTaskIds.length > 0 || stage.missingTestBaselines.length > 0)

  return {
    status: blockedStages.length === 0 ? "ready" : "blocked",
    completedStageIds: stages
      .filter((stage) => !blockedStages.some((blocked) => blocked.stageId === stage.id))
      .map((stage) => stage.id),
    blockedStages,
    fallbackModes: getSetupVisualizationFallbackModes(input.language),
    releaseChecklist: getSetupVisualizationReleaseChecklist(input.language),
  }
}
