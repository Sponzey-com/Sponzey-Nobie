import { pickUiText, type UiLanguage } from "../stores/uiLanguage"

export type OrchestrationLegacyToolId =
  | "topology"
  | "advanced_editor"
  | "import_export"
  | "relationship_graph"
  | "profile_preview"
  | "runtime_sub_sessions"

export type OrchestrationSurfacePolicyId = "agents_page" | "advanced_agents_page" | "settings_preview"
export type OrchestrationSurfaceVisibility = "secondary" | "hidden"
export type OrchestrationParityPlacement = "hidden" | "preview" | "editable"
export type OrchestrationPolicyFieldId =
  | "memoryPolicy"
  | "delegation"
  | "rateLimit"
  | "secretScopeId"
  | "disabledToolNames"

export interface OrchestrationLegacyToolPolicy {
  id: OrchestrationLegacyToolId
  label: string
  visibility: OrchestrationSurfaceVisibility
  emphasized: boolean
  description: string
}

export interface OrchestrationSurfacePolicy {
  id: OrchestrationSurfacePolicyId
  surface: "page" | "settings"
  pathname: string
  title: string
  description: string
  defaultLegacyToolId: OrchestrationLegacyToolId
  legacySurfaceVisible: boolean
  legacySurfaceDefaultOpen: boolean
  settingsPreviewOnly: boolean
  showsAdvancedDiagnostics: boolean
  showsRawInspection: boolean
  tools: OrchestrationLegacyToolPolicy[]
  badges: string[]
  secondarySummary: string
}

export interface OrchestrationPolicyParityField {
  id: OrchestrationPolicyFieldId
  label: string
  description: string
  quickEdit: OrchestrationParityPlacement
  advancedFoldout: OrchestrationParityPlacement
  legacyOverlay: OrchestrationParityPlacement
  settingsPreview: OrchestrationParityPlacement
}

const LEGACY_TOOL_IDS: OrchestrationLegacyToolId[] = [
  "topology",
  "advanced_editor",
  "import_export",
  "relationship_graph",
  "profile_preview",
  "runtime_sub_sessions",
]

export function resolveOrchestrationSurfacePolicy(input: {
  surface: "page" | "settings"
  pathname?: string
  language: UiLanguage
}): OrchestrationSurfacePolicy {
  const pathname = input.pathname ?? (input.surface === "settings" ? "/settings" : "/agents")
  const t = (ko: string, en: string) => pickUiText(input.language, ko, en)
  const tools = buildLegacyToolPolicies(input.language)

  if (input.surface === "settings") {
    return {
      id: "settings_preview",
      surface: input.surface,
      pathname,
      title: t("Settings preview-only agents 탭", "Settings preview-only agents tab"),
      description: t(
        "같은 map projection은 유지하되, 저장과 raw editing은 `/agents` 계열 studio에서만 수행합니다.",
        "The same map projection stays visible, but saving and raw editing remain exclusive to the `/agents` studio surfaces.",
      ),
      defaultLegacyToolId: "topology",
      legacySurfaceVisible: false,
      legacySurfaceDefaultOpen: false,
      settingsPreviewOnly: true,
      showsAdvancedDiagnostics: false,
      showsRawInspection: false,
      tools: tools.map((tool) => ({ ...tool, visibility: "hidden" })),
      badges: [
        t("preview only", "preview only"),
        t("Open Studio 필요", "Open Studio required"),
        t("topology secondary", "topology secondary"),
      ],
      secondarySummary: t(
        "Topology/Yeonjang과 고급 정책 parity는 settings 탭에서 직접 편집하지 않고, 전용 studio secondary surface에서만 확인합니다.",
        "Topology/Yeonjang and advanced policy parity stay out of direct editing in Settings and move to the dedicated studio secondary surface.",
      ),
    }
  }

  const advancedRoute = pathname.startsWith("/advanced/agents")
  return {
    id: advancedRoute ? "advanced_agents_page" : "agents_page",
    surface: input.surface,
    pathname,
    title: advancedRoute
      ? t("고급 secondary utilities", "Advanced secondary utilities")
      : t("보조 legacy utilities", "Secondary legacy utilities"),
    description: advancedRoute
      ? t(
          "고급 route는 같은 main shell을 유지하면서 diagnostics, topology, raw inspection을 더 강하게 노출합니다.",
          "The advanced route keeps the same main shell while exposing diagnostics, topology, and raw inspection more aggressively.",
        )
      : t(
          "메인 map/studio를 흐리지 않도록 기존 폼/그래프/진단 도구는 secondary utility surface로 내립니다.",
          "Legacy forms, graphs, and diagnostics are moved into a secondary utility surface so the main map/studio stays primary.",
        ),
    defaultLegacyToolId: "topology",
    legacySurfaceVisible: true,
    legacySurfaceDefaultOpen: advancedRoute,
    settingsPreviewOnly: false,
    showsAdvancedDiagnostics: advancedRoute,
    showsRawInspection: advancedRoute,
    tools: tools.map((tool) => ({
      ...tool,
      visibility: "secondary",
      emphasized: advancedRoute
        ? tool.id === "topology" || tool.id === "advanced_editor" || tool.id === "relationship_graph" || tool.id === "runtime_sub_sessions"
        : tool.id === "topology" || tool.id === "advanced_editor",
    })),
    badges: advancedRoute
      ? [
          t("primary edit", "primary edit"),
          t("advanced diagnostics", "advanced diagnostics"),
          t("raw inspection", "raw inspection"),
        ]
      : [
          t("primary edit", "primary edit"),
          t("secondary legacy", "secondary legacy"),
          t("topology / Yeonjang", "topology / Yeonjang"),
        ],
    secondarySummary: advancedRoute
      ? t(
          "Topology/Yeonjang과 raw policy inspection은 이 route에서 더 깊게 보이지만, main map membership editor와는 분리된 보조 surface입니다.",
          "Topology/Yeonjang and raw policy inspection are more visible on this route, but they stay separate from the main map membership editor.",
        )
      : t(
          "Topology/Yeonjang과 legacy tools는 유지하되, membership drag/drop과 quick edit보다 앞에 나오지 않도록 보조 surface로 유지합니다.",
          "Topology/Yeonjang and legacy tools remain available, but stay secondary so they do not overtake membership drag/drop and quick edit.",
        ),
  }
}

export function buildOrchestrationPolicyParityFields(language: UiLanguage): OrchestrationPolicyParityField[] {
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  return [
    {
      id: "memoryPolicy",
      label: t("메모리 범위", "Memory policy"),
      description: t(
        "소유자, 읽기 범위, 쓰기 범위는 quick edit에서 숨기고 advanced foldout preview로만 요약합니다.",
        "Owner, read scopes, and write scope stay hidden from quick edit and appear only as an advanced foldout preview.",
      ),
      quickEdit: "hidden",
      advancedFoldout: "preview",
      legacyOverlay: "editable",
      settingsPreview: "preview",
    },
    {
      id: "delegation",
      label: t("위임", "Delegation"),
      description: t(
        "enabled, parallelism, retry budget은 고급 parity 대상이며 legacy editor가 최종 raw edit surface를 유지합니다.",
        "Enabled state, parallelism, and retry budget remain advanced parity items, with the legacy editor as the final raw editing surface.",
      ),
      quickEdit: "hidden",
      advancedFoldout: "preview",
      legacyOverlay: "editable",
      settingsPreview: "preview",
    },
    {
      id: "rateLimit",
      label: t("호출 제한", "Rate limit"),
      description: t(
        "동시 호출 수와 분당 제한은 advanced foldout에서 preview하고, 실제 수정은 legacy overlay에서 계속 관리합니다.",
        "Concurrent and per-minute limits are previewed in the advanced foldout while real edits remain in the legacy overlay.",
      ),
      quickEdit: "hidden",
      advancedFoldout: "preview",
      legacyOverlay: "editable",
      settingsPreview: "preview",
    },
    {
      id: "secretScopeId",
      label: t("Secret scope", "Secret scope"),
      description: t(
        "secret scope는 사용자가 사라졌다고 오해하지 않도록 foldout preview와 legacy raw editor를 함께 유지합니다.",
        "The secret scope stays visible through the foldout preview plus the legacy raw editor so it never silently disappears.",
      ),
      quickEdit: "hidden",
      advancedFoldout: "preview",
      legacyOverlay: "editable",
      settingsPreview: "preview",
    },
    {
      id: "disabledToolNames",
      label: t("비활성 도구", "Disabled tools"),
      description: t(
        "disabled tool list는 compact quick sheet에 올리지 않고, advanced preview와 legacy edit path를 병행합니다.",
        "The disabled tool list stays out of the compact quick sheet and instead uses the advanced preview plus the legacy edit path.",
      ),
      quickEdit: "hidden",
      advancedFoldout: "preview",
      legacyOverlay: "editable",
      settingsPreview: "preview",
    },
  ]
}

export function formatOrchestrationParityPlacement(
  placement: OrchestrationParityPlacement,
  language: UiLanguage,
): string {
  switch (placement) {
    case "editable":
      return pickUiText(language, "editable", "editable")
    case "preview":
      return pickUiText(language, "preview", "preview")
    case "hidden":
    default:
      return pickUiText(language, "hidden", "hidden")
  }
}

function buildLegacyToolPolicies(language: UiLanguage): OrchestrationLegacyToolPolicy[] {
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  const descriptions: Record<OrchestrationLegacyToolId, string> = {
    topology: t(
      "Yeonjang shared hub와 topology gate를 membership map과 분리해 보여주는 보조 surface입니다.",
      "A secondary surface for the Yeonjang shared hub and topology gate, kept separate from the membership map.",
    ),
    advanced_editor: t(
      "raw agent/team upsert와 validation-only write를 위한 레거시 고급 편집기입니다.",
      "The legacy advanced editor for raw agent/team upsert and validation-only writes.",
    ),
    import_export: t(
      "masked config export, import validation, overwrite flow를 보조적으로 유지합니다.",
      "Keeps masked config export, import validation, and overwrite flows as secondary utilities.",
    ),
    relationship_graph: t(
      "team, delegation, capability edge를 raw graph 관점에서 다시 보는 보조 그래프입니다.",
      "A secondary raw graph for team, delegation, and capability edges.",
    ),
    profile_preview: t(
      "선택한 항목의 전체 profile warning과 raw config preview를 다시 확인하는 보조 preview입니다.",
      "A secondary preview for full profile warnings and raw config inspection of the selected item.",
    ),
    runtime_sub_sessions: t(
      "parent runId 기준으로 runtime sub-session을 조회하는 진단용 surface입니다.",
      "A diagnostic surface for runtime sub-sessions by parent runId.",
    ),
  }
  const labels: Record<OrchestrationLegacyToolId, string> = {
    topology: t("Topology / Yeonjang", "Topology / Yeonjang"),
    advanced_editor: t("Advanced editor", "Advanced editor"),
    import_export: t("Import / export", "Import / export"),
    relationship_graph: t("Relationship graph", "Relationship graph"),
    profile_preview: t("Profile preview", "Profile preview"),
    runtime_sub_sessions: t("Runtime sessions", "Runtime sessions"),
  }

  return LEGACY_TOOL_IDS.map((id) => ({
    id,
    label: labels[id],
    visibility: "secondary",
    emphasized: id === "topology" || id === "advanced_editor",
    description: descriptions[id],
  }))
}
