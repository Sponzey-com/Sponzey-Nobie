export type TopologyWorkspaceLayer = "build" | "run" | "trace" | "improve" | "resources"
export type TopologyWorkspaceExposureMode = "simple" | "advanced" | "developer"

export interface TopologyWorkspaceLayerCopy {
  layer: TopologyWorkspaceLayer
  labelKo: string
  labelEn: string
  tooltipKo: string
  tooltipEn: string
}

export interface TopologyWorkspaceUserTermCopy {
  key: "executor" | "connection" | "input" | "run" | "runRecord" | "issue"
  labelKo: string
  labelEn: string
  descriptionKo: string
  descriptionEn: string
}

export type TopologyWorkspaceSectionId =
  | "simpleCreatePanel"
  | "advancedPalette"
  | "taskPresetPicker"
  | "relationModeToolbar"
  | "runInput"
  | "runTemplatePicker"
  | "contextPicker"
  | "runSimulationMode"
  | "runTargetPanel"
  | "compilePreview"
  | "resourcesLayer"
  | "importExport"
  | "rawTrace"
  | "featureFlagStatus"

export interface TopologyWorkspaceSectionPolicy {
  section: TopologyWorkspaceSectionId
  labelKo: string
  labelEn: string
  visibleIn: TopologyWorkspaceExposureMode[]
  descriptionKo: string
  descriptionEn: string
}

export const TOPOLOGY_WORKSPACE_LAYER_COPY: TopologyWorkspaceLayerCopy[] = [
  {
    layer: "build",
    labelKo: "만들기",
    labelEn: "Build",
    tooltipKo: "실행자를 만들고 실행자끼리 연결한다.",
    tooltipEn: "Create executors and connect them.",
  },
  {
    layer: "run",
    labelKo: "실행",
    labelEn: "Run",
    tooltipKo: "입력을 넣고 실행자 흐름을 실행한다.",
    tooltipEn: "Run the executor flow with an input.",
  },
  {
    layer: "trace",
    labelKo: "기록",
    labelEn: "Trace",
    tooltipKo: "실행자가 어떤 순서로 처리했는지 본다.",
    tooltipEn: "Review how executors handled the run.",
  },
  {
    layer: "improve",
    labelKo: "개선",
    labelEn: "Improve",
    tooltipKo: "실패 위치와 고칠 점을 확인한다.",
    tooltipEn: "Review failure points and fixes.",
  },
  {
    layer: "resources",
    labelKo: "리소스",
    labelEn: "Resources",
    tooltipKo: "내부 projection 전용 레이어입니다. 기본 토폴로지 화면에는 노출하지 않습니다.",
    tooltipEn: "Internal projection-only layer. It is not exposed in the default topology screen.",
  },
]

export const TOPOLOGY_WORKSPACE_USER_TERMS: TopologyWorkspaceUserTermCopy[] = [
  {
    key: "executor",
    labelKo: "실행자",
    labelEn: "Executor",
    descriptionKo: "일을 맡아 처리하거나 확인하는 대상.",
    descriptionEn: "The person or automation responsible for doing or checking work.",
  },
  {
    key: "connection",
    labelKo: "연결",
    labelEn: "Connection",
    descriptionKo: "한 실행자에서 다음 실행자로 일을 넘기는 선.",
    descriptionEn: "A line that passes work from one executor to the next.",
  },
  {
    key: "input",
    labelKo: "입력",
    labelEn: "Input",
    descriptionKo: "실행할 때 실행자 흐름에 전달하는 요청.",
    descriptionEn: "The request passed into the executor flow when it runs.",
  },
  {
    key: "run",
    labelKo: "실행",
    labelEn: "Run",
    descriptionKo: "실행자 흐름을 한 번 시작하는 일.",
    descriptionEn: "One started execution of an executor flow.",
  },
  {
    key: "runRecord",
    labelKo: "기록",
    labelEn: "History",
    descriptionKo: "실행자가 어떤 순서로 처리했는지 남은 기록.",
    descriptionEn: "A record of how executors handled the run.",
  },
  {
    key: "issue",
    labelKo: "고칠 점",
    labelEn: "Issue",
    descriptionKo: "실행 전후에 확인하거나 고쳐야 하는 항목.",
    descriptionEn: "Something to review or fix before or after running.",
  },
]

export const TOPOLOGY_WORKSPACE_INTERNAL_TERMS = [
  "Declared",
  "Observed",
  "CompiledSnapshot",
  "CompiledTopologySnapshot",
  "SubSession",
  "AgentConfig",
  "WorkOrder Template",
  "Context Preset",
  "NodeContract",
  "Node Contract",
  "EnterpriseTopology",
  "Enterprise Topology",
  "AuthorityScope",
  "Authority Scope",
  "FailureExhaustion",
  "Failure Exhaustion",
  "Runtime Profile",
  "Runtime Resource Topology",
] as const

export const TOPOLOGY_WORKSPACE_SIMPLE_CONCEPTS = [
  "실행자",
  "연결",
  "입력",
  "실행",
  "기록",
  "고칠 점",
] as const

export const TOPOLOGY_WORKSPACE_SIMPLE_BLOCKED_PALETTE_LABELS = [
  "Task",
  "Decision",
  "Approval",
  "Tool",
  "Data",
  "Group",
] as const

export const TOPOLOGY_WORKSPACE_ADVANCED_ONLY_LABELS = [
  "WorkOrder Template",
  "Context",
  "Compile Preview",
  "Resources",
  "JSON/YAML",
  "Agent/Team",
] as const

export const TOPOLOGY_WORKSPACE_SECTION_POLICIES: TopologyWorkspaceSectionPolicy[] = [
  {
    section: "simpleCreatePanel",
    labelKo: "실행자 만들기",
    labelEn: "Create executors",
    visibleIn: ["simple"],
    descriptionKo: "기본 화면의 실행자/영역 추가 동작.",
    descriptionEn: "Primary executor and section creation in the simple view.",
  },
  {
    section: "advancedPalette",
    labelKo: "고급 팔레트",
    labelEn: "Advanced palette",
    visibleIn: ["advanced", "developer"],
    descriptionKo: "Task, Decision, Approval, Tool, Data, Group 등 내부 모델링 블록.",
    descriptionEn: "Internal modeling blocks such as Task, Decision, Approval, Tool, Data, and Group.",
  },
  {
    section: "taskPresetPicker",
    labelKo: "업무 유형 preset",
    labelEn: "Work type presets",
    visibleIn: ["advanced", "developer"],
    descriptionKo: "업무 유형 직접 선택. 기본 화면에서는 노비가 추론한다.",
    descriptionEn: "Direct work-type selection. Nobie infers this in the simple view.",
  },
  {
    section: "relationModeToolbar",
    labelKo: "관계 모드",
    labelEn: "Relation mode",
    visibleIn: ["advanced", "developer"],
    descriptionKo: "내부 relation type 직접 선택.",
    descriptionEn: "Direct internal relation-type selection.",
  },
  {
    section: "runInput",
    labelKo: "입력",
    labelEn: "Input",
    visibleIn: ["simple", "advanced", "developer"],
    descriptionKo: "실행자 흐름을 실행할 때 전달하는 요청.",
    descriptionEn: "Request passed into the executor flow.",
  },
  {
    section: "runTemplatePicker",
    labelKo: "WorkOrder Template",
    labelEn: "WorkOrder Template",
    visibleIn: ["advanced", "developer"],
    descriptionKo: "WorkOrder Template 직접 선택. 기본 화면에서는 숨긴다.",
    descriptionEn: "Direct WorkOrder Template selection. Hidden in the simple view.",
  },
  {
    section: "contextPicker",
    labelKo: "Context",
    labelEn: "Context",
    visibleIn: ["advanced", "developer"],
    descriptionKo: "Context 직접 선택. 기본 화면에서는 숨긴다.",
    descriptionEn: "Direct Context selection. Hidden in the simple view.",
  },
  {
    section: "runSimulationMode",
    labelKo: "성공/실패 시뮬레이션",
    labelEn: "Success/failure simulation",
    visibleIn: ["advanced", "developer"],
    descriptionKo: "실행 시뮬레이션 모드 직접 선택.",
    descriptionEn: "Direct run simulation mode selection.",
  },
  {
    section: "runTargetPanel",
    labelKo: "Run Target",
    labelEn: "Run Target",
    visibleIn: ["advanced", "developer"],
    descriptionKo: "실행 시작 노드 직접 지정.",
    descriptionEn: "Direct run entry node selection.",
  },
  {
    section: "compilePreview",
    labelKo: "Compile Preview",
    labelEn: "Compile Preview",
    visibleIn: ["advanced", "developer"],
    descriptionKo: "컴파일된 내부 실행 구조 미리보기.",
    descriptionEn: "Preview of the compiled internal runtime structure.",
  },
  {
    section: "resourcesLayer",
    labelKo: "Resources",
    labelEn: "Resources",
    visibleIn: ["advanced", "developer"],
    descriptionKo: "Agent/Team 등 실행 리소스 projection.",
    descriptionEn: "Execution resource projection such as Agent and Team.",
  },
  {
    section: "importExport",
    labelKo: "JSON/YAML",
    labelEn: "JSON/YAML",
    visibleIn: ["advanced", "developer"],
    descriptionKo: "개발자용 가져오기/내보내기.",
    descriptionEn: "Developer import/export.",
  },
  {
    section: "rawTrace",
    labelKo: "Raw trace",
    labelEn: "Raw trace",
    visibleIn: ["advanced", "developer"],
    descriptionKo: "운영/디버그용 원시 실행 기록.",
    descriptionEn: "Raw execution trace for operations and debugging.",
  },
  {
    section: "featureFlagStatus",
    labelKo: "기능 상태",
    labelEn: "Feature status",
    visibleIn: ["developer"],
    descriptionKo: "기능 플래그와 rollout 상태.",
    descriptionEn: "Feature flag and rollout state.",
  },
]

export const TOPOLOGY_WORKSPACE_FEATURE_FALLBACK_COPY = {
  disabledReasonKo:
    "토폴로지 작업공간은 관리자 설정(기능 플래그)이 꺼져 있어 사용할 수 없습니다. 관리자에게 실행자 그래프 작업공간을 켜 달라고 요청하세요.",
  disabledReasonEn:
    "Topology Workspace is unavailable because the administrator setting (feature flag) is off. Ask an administrator to enable the Executor Graph workspace.",
} as const

export function topologyWorkspaceVisibleLayers(
  _mode: TopologyWorkspaceExposureMode,
): TopologyWorkspaceLayerCopy[] {
  return TOPOLOGY_WORKSPACE_LAYER_COPY.filter((item) => item.layer !== "resources")
}

export function shouldShowTopologyWorkspaceAdvancedSurface(_mode: TopologyWorkspaceExposureMode): boolean {
  return false
}

export function topologyWorkspaceSectionPolicy(
  section: TopologyWorkspaceSectionId,
): TopologyWorkspaceSectionPolicy {
  const policy = TOPOLOGY_WORKSPACE_SECTION_POLICIES.find((item) => item.section === section)
  if (!policy) {
    throw new Error(`Unknown topology workspace section: ${section}`)
  }
  return policy
}

export function isTopologyWorkspaceSectionVisible(
  mode: TopologyWorkspaceExposureMode,
  section: TopologyWorkspaceSectionId,
): boolean {
  if (mode !== "simple") return false
  return topologyWorkspaceSectionPolicy(section).visibleIn.includes(mode)
}

export function topologyWorkspaceVisibleSections(
  mode: TopologyWorkspaceExposureMode,
): TopologyWorkspaceSectionPolicy[] {
  if (mode !== "simple") return []
  return TOPOLOGY_WORKSPACE_SECTION_POLICIES.filter((item) => item.visibleIn.includes(mode))
}

export function resolveTopologyWorkspaceExposureMode(_search: string): TopologyWorkspaceExposureMode {
  return "simple"
}

export function resolveTopologyWorkspaceExposureModeForRoute(input: {
  search: string
  pathname?: string
}): TopologyWorkspaceExposureMode {
  void input
  return "simple"
}

export const TOPOLOGY_WORKSPACE_FIRST_START_COPY = {
  titleKo: "첫 업무 흐름 만들기",
  titleEn: "Create your first work flow",
  descriptionKo: "실행자 예시를 고르면 연결까지 자동으로 채워진다.",
  descriptionEn: "Choose an executor example to start with connections already filled in.",
  primaryActionKo: "첫 실행자 추가",
  primaryActionEn: "Add first executor",
  templateSectionKo: "바로 시작",
  templateSectionEn: "Start quickly",
  blankTemplateKo: "빈 그래프",
  blankTemplateEn: "Blank graph",
} as const

export const TOPOLOGY_WORKSPACE_BEGINNER_COPY_SURFACE = {
  concepts: [...TOPOLOGY_WORKSPACE_SIMPLE_CONCEPTS],
  layers: topologyWorkspaceVisibleLayers("simple").map((item) => ({
    labelKo: item.labelKo,
    labelEn: item.labelEn,
    tooltipKo: item.tooltipKo,
    tooltipEn: item.tooltipEn,
  })),
  terms: TOPOLOGY_WORKSPACE_USER_TERMS.map((item) => ({
    labelKo: item.labelKo,
    labelEn: item.labelEn,
    descriptionKo: item.descriptionKo,
    descriptionEn: item.descriptionEn,
  })),
  firstStart: TOPOLOGY_WORKSPACE_FIRST_START_COPY,
}

export const TOPOLOGY_WORKSPACE_ADVANCED_COPY_SURFACE = {
  layers: [],
  sections: [],
}

export function containsInternalTopologyTerm(value: string): boolean {
  return TOPOLOGY_WORKSPACE_INTERNAL_TERMS.some((term) => value.includes(term))
}

export function topologyWorkspaceLayerLabel(layer: TopologyWorkspaceLayer, language: "ko" | "en"): string {
  const copy = TOPOLOGY_WORKSPACE_LAYER_COPY.find((item) => item.layer === layer)
  if (!copy) return layer
  return language === "ko" ? copy.labelKo : copy.labelEn
}
