import * as React from "react"
import {
  ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
  type EnterpriseEntityRef,
  type EnterpriseEntityType,
  type EnterpriseRelation,
  type EnterpriseRelationType,
  type EnterpriseTimestamp,
  type EnterpriseTopology,
  type NodeType,
} from "../../contracts/enterprise-topology"
import type {
  TopologyRelationLayer,
  TopologyRelationTemplateCatalog,
  TopologyRelationTemplatePreset,
  TopologySmartConnectEndpoint,
  TopologySmartConnectRecommendation,
  TopologySmartConnectDirection,
} from "../../contracts/relation-templates"
import { useUiI18n } from "../../lib/ui-i18n"

export type TopologyRelationEasyModeId = "next" | "delegate" | "approve" | "use" | "report"
export type TopologyRelationModeId = "smart_connect" | TopologyRelationEasyModeId | EnterpriseRelationType

const PRIMARY_RELATION_TYPES: EnterpriseRelationType[] = [
  "delegates_to",
  "reports_to",
  "approves",
  "uses_tool",
  "uses_system",
]

const EASY_RELATION_MODES: Array<{
  modeId: TopologyRelationEasyModeId
  labelKo: string
  labelEn: string
  descriptionKo: string
  descriptionEn: string
}> = [
  {
    modeId: "next",
    labelKo: "Next",
    labelEn: "Next",
    descriptionKo: "다음 업무 단계로 연결",
    descriptionEn: "Connect as the next work step",
  },
  {
    modeId: "delegate",
    labelKo: "Delegate",
    labelEn: "Delegate",
    descriptionKo: "하위 업무 위임 경로로 연결",
    descriptionEn: "Connect as a delegation path",
  },
  {
    modeId: "approve",
    labelKo: "Approve",
    labelEn: "Approve",
    descriptionKo: "승인 단계 또는 승인 주체와 연결",
    descriptionEn: "Connect approval step or authority holder",
  },
  {
    modeId: "use",
    labelKo: "Use",
    labelEn: "Use",
    descriptionKo: "도구 또는 데이터 사용으로 연결",
    descriptionEn: "Connect tool or data usage",
  },
  {
    modeId: "report",
    labelKo: "Report",
    labelEn: "Report",
    descriptionKo: "보고 관계로 연결",
    descriptionEn: "Connect as reporting relation",
  },
]

export const FALLBACK_RELATION_TEMPLATE_CATALOG: TopologyRelationTemplateCatalog = {
  schemaVersion: 1,
  presets: [
    {
      relationType: "delegates_to",
      labelKo: "위임",
      labelEn: "Delegates to",
      descriptionKo: "실행 가능한 업무 노드 간 위임 경로",
      descriptionEn: "Executable delegation path between work nodes",
      group: "primary",
      layer: "runtime",
      runtimeCandidate: true,
      easyLabelKo: "다음",
      easyLabelEn: "Next",
      smartConnectLabelKo: "다음 업무로 연결",
      smartConnectLabelEn: "Connect to next work step",
      allowedPairs: [{ from: "node", to: "node" }],
    },
    {
      relationType: "reports_to",
      labelKo: "보고",
      labelEn: "Reports to",
      descriptionKo: "직책 또는 담당자 간 보고 관계",
      descriptionEn: "Reporting relation between positions or people",
      group: "primary",
      layer: "analysis",
      runtimeCandidate: false,
      easyLabelKo: "보고",
      easyLabelEn: "Report",
      smartConnectLabelKo: "보고 관계로 연결",
      smartConnectLabelEn: "Connect as reporting relation",
      allowedPairs: [{ from: "position", to: "position" }, { from: "person", to: "person" }],
    },
    {
      relationType: "approves",
      labelKo: "승인",
      labelEn: "Approves",
      descriptionKo: "조직/직책/담당자가 업무 대상을 승인",
      descriptionEn: "Authority holder approves a work target",
      group: "primary",
      layer: "authority",
      runtimeCandidate: false,
      easyLabelKo: "승인",
      easyLabelEn: "Approve",
      smartConnectLabelKo: "승인 관계로 연결",
      smartConnectLabelEn: "Connect as approval relation",
      allowedPairs: [
        { from: "position", to: "node" },
        { from: "person", to: "node" },
        { from: "org_unit", to: "node" },
      ],
    },
    {
      relationType: "uses_tool",
      labelKo: "도구 사용",
      labelEn: "Uses tool",
      descriptionKo: "업무 노드가 도구를 사용",
      descriptionEn: "Work node uses a tool",
      group: "primary",
      layer: "technical",
      runtimeCandidate: false,
      easyLabelKo: "사용",
      easyLabelEn: "Use",
      smartConnectLabelKo: "도구 사용으로 연결",
      smartConnectLabelEn: "Connect as tool use",
      allowedPairs: [{ from: "node", to: "enterprise_tool" }],
    },
    {
      relationType: "uses_system",
      labelKo: "시스템 사용",
      labelEn: "Uses system",
      descriptionKo: "업무 노드 또는 프로세스가 시스템을 사용",
      descriptionEn: "Work node or process uses a system",
      group: "primary",
      layer: "technical",
      runtimeCandidate: false,
      easyLabelKo: "사용",
      easyLabelEn: "Use",
      smartConnectLabelKo: "시스템 사용으로 연결",
      smartConnectLabelEn: "Connect as system use",
      allowedPairs: [{ from: "node", to: "enterprise_system" }, { from: "process_definition", to: "enterprise_system" }],
    },
    {
      relationType: "owns",
      labelKo: "소유",
      labelEn: "Owns",
      descriptionKo: "업무, 시스템, 도구 책임 소유",
      descriptionEn: "Ownership over work, systems, or tools",
      group: "more",
      layer: "authority",
      runtimeCandidate: false,
      easyLabelKo: "소유",
      easyLabelEn: "Own",
      allowedPairs: [{ from: "org_unit", to: "node" }, { from: "position", to: "enterprise_system" }],
    },
    {
      relationType: "belongs_to",
      labelKo: "소속",
      labelEn: "Belongs to",
      descriptionKo: "팀 또는 조직 소속",
      descriptionEn: "Membership in team or org unit",
      group: "more",
      layer: "analysis",
      runtimeCandidate: false,
      easyLabelKo: "소속",
      easyLabelEn: "Belongs to",
      smartConnectLabelKo: "그룹에 넣기",
      smartConnectLabelEn: "Put into group",
      allowedPairs: [{ from: "node", to: "team" }, { from: "team", to: "org_unit" }],
    },
  ],
}

export interface EnterpriseRelationModeIssue {
  reasonCode: "invalid_relation_endpoint" | "unknown_relation_endpoint" | "no_smart_relation"
  severity: "blocked" | "warning"
  message: string
  sourceEntityType?: EnterpriseEntityType
  targetEntityType?: EnterpriseEntityType
  relationType?: EnterpriseRelationType
  relationMode: TopologyRelationModeId
  suggestedRelationTypes: EnterpriseRelationType[]
  suggestedModes: TopologyRelationModeId[]
}

export type EnterpriseRelationDraftResult =
  | {
      ok: true
      topology: EnterpriseTopology
      relation: EnterpriseRelation
      layer: TopologyRelationLayer
      runtimeCandidate: boolean
    }
  | {
      ok: false
      issue: EnterpriseRelationModeIssue
    }

export function splitRelationTemplateCatalog(catalog?: TopologyRelationTemplateCatalog | null): {
  primary: TopologyRelationTemplatePreset[]
  more: TopologyRelationTemplatePreset[]
} {
  const presets = catalog?.presets ?? FALLBACK_RELATION_TEMPLATE_CATALOG.presets
  return {
    primary: PRIMARY_RELATION_TYPES
      .map((relationType) => presets.find((preset) => preset.relationType === relationType))
      .filter((preset): preset is TopologyRelationTemplatePreset => Boolean(preset)),
    more: presets.filter((preset) => !PRIMARY_RELATION_TYPES.includes(preset.relationType)),
  }
}

function parseCanvasNodeRef(nodeId: string): EnterpriseEntityRef | null {
  const separator = nodeId.indexOf(":")
  if (separator <= 0 || separator >= nodeId.length - 1) return null
  return {
    entityType: nodeId.slice(0, separator) as EnterpriseEntityType,
    id: nodeId.slice(separator + 1),
  }
}

function relationPreset(
  catalog: TopologyRelationTemplateCatalog | null | undefined,
  relationType: EnterpriseRelationType,
): TopologyRelationTemplatePreset | undefined {
  return (catalog?.presets ?? FALLBACK_RELATION_TEMPLATE_CATALOG.presets)
    .find((preset) => preset.relationType === relationType)
}

function isEasyRelationMode(value: TopologyRelationModeId): value is TopologyRelationEasyModeId {
  return value === "next" || value === "delegate" || value === "approve" || value === "use" || value === "report"
}

function isRawRelationMode(value: TopologyRelationModeId): value is EnterpriseRelationType {
  return value !== "smart_connect" && !isEasyRelationMode(value)
}

function nodeTypeForRef(topology: EnterpriseTopology, ref: EnterpriseEntityRef): NodeType | undefined {
  if (ref.entityType !== "node") return undefined
  return topology.nodes.find((node) => node.id === ref.id)?.nodeType
}

function endpointForRef(topology: EnterpriseTopology, ref: EnterpriseEntityRef): TopologySmartConnectEndpoint {
  return {
    entityType: ref.entityType,
    ...(nodeTypeForRef(topology, ref) !== undefined ? { nodeType: nodeTypeForRef(topology, ref) } : {}),
  }
}

function isAllowedPair(
  preset: TopologyRelationTemplatePreset,
  from: EnterpriseEntityType,
  to: EnterpriseEntityType,
): boolean {
  return preset.allowedPairs.some((pair) => pair.from === from && pair.to === to)
}

function smartConnectEasyMode(
  preset: TopologyRelationTemplatePreset,
  source: TopologySmartConnectEndpoint,
  target: TopologySmartConnectEndpoint,
): TopologyRelationEasyModeId | "group" {
  if (source.entityType === "node" && target.entityType === "node" && target.nodeType === "approval_node") return "approve"
  if (preset.relationType === "delegates_to") return "next"
  if (preset.relationType === "approves") return "approve"
  if (preset.relationType === "uses_tool" || preset.relationType === "uses_system") return "use"
  if (preset.relationType === "reports_to") return "report"
  if (preset.relationType === "belongs_to") return "group"
  return "delegate"
}

function smartConnectPriority(
  preset: TopologyRelationTemplatePreset,
  direction: TopologySmartConnectDirection,
  source: TopologySmartConnectEndpoint,
  target: TopologySmartConnectEndpoint,
): number {
  if (source.entityType === "node" && target.entityType === "node" && target.nodeType === "approval_node" && preset.relationType === "delegates_to") return 5
  if (source.entityType === "node" && target.entityType === "node" && preset.relationType === "delegates_to") return 10
  if (source.entityType === "node" && target.entityType === "enterprise_tool" && preset.relationType === "uses_tool") return 10
  if (source.entityType === "node" && target.entityType === "enterprise_system" && preset.relationType === "uses_system") return 10
  if (direction === "target_to_source" && preset.relationType === "belongs_to") return 15
  if (preset.group === "primary") return 30
  return 60
}

function smartConnectReason(
  preset: TopologyRelationTemplatePreset,
  direction: TopologySmartConnectDirection,
): { ko: string; en: string } {
  if (direction === "target_to_source") {
    return {
      ko: "반대 방향으로 저장하면 자연스럽다.",
      en: "This is more natural when saved in the reverse direction.",
    }
  }
  if (preset.runtimeCandidate) {
    return {
      ko: "실행 경로로 사용할 수 있는 연결이다.",
      en: "This relation can become a runtime path.",
    }
  }
  return {
    ko: "이 두 항목에 사용할 수 있는 연결이다.",
    en: "This relation is valid for these two items.",
  }
}

function buildSmartConnectRecommendation(input: {
  preset: TopologyRelationTemplatePreset
  direction: TopologySmartConnectDirection
  source: TopologySmartConnectEndpoint
  target: TopologySmartConnectEndpoint
}): TopologySmartConnectRecommendation {
  const { preset, direction, source, target } = input
  const approvalStep = source.entityType === "node" && target.entityType === "node" && target.nodeType === "approval_node"
  const reason = smartConnectReason(preset, direction)
  return {
    relationType: preset.relationType,
    easyMode: smartConnectEasyMode(preset, source, target),
    direction,
    labelKo: approvalStep && preset.relationType === "delegates_to"
      ? "승인 단계로 연결"
      : preset.smartConnectLabelKo ?? preset.easyLabelKo ?? preset.labelKo,
    labelEn: approvalStep && preset.relationType === "delegates_to"
      ? "Connect to approval step"
      : preset.smartConnectLabelEn ?? preset.easyLabelEn ?? preset.labelEn,
    reasonKo: reason.ko,
    reasonEn: reason.en,
    layer: preset.layer,
    runtimeCandidate: preset.runtimeCandidate,
    priority: smartConnectPriority(preset, direction, source, target),
  }
}

export function recommendTopologyRelationMode(input: {
  source: TopologySmartConnectEndpoint
  target: TopologySmartConnectEndpoint
  catalog?: TopologyRelationTemplateCatalog | null
}): TopologySmartConnectRecommendation | undefined {
  const catalog = input.catalog ?? FALLBACK_RELATION_TEMPLATE_CATALOG
  const recommendations: TopologySmartConnectRecommendation[] = []
  for (const preset of catalog.presets) {
    if (isAllowedPair(preset, input.source.entityType, input.target.entityType)) {
      recommendations.push(buildSmartConnectRecommendation({
        preset,
        direction: "source_to_target",
        source: input.source,
        target: input.target,
      }))
    }
    if (isAllowedPair(preset, input.target.entityType, input.source.entityType)) {
      recommendations.push(buildSmartConnectRecommendation({
        preset,
        direction: "target_to_source",
        source: input.source,
        target: input.target,
      }))
    }
  }
  return recommendations.sort((a, b) => a.priority - b.priority || a.labelKo.localeCompare(b.labelKo))[0]
}

function easyModeRelationType(
  mode: TopologyRelationEasyModeId,
  source: TopologySmartConnectEndpoint,
  target: TopologySmartConnectEndpoint,
): EnterpriseRelationType {
  if (mode === "approve" && !(source.entityType === "node" && target.entityType === "node" && target.nodeType === "approval_node")) {
    return "approves"
  }
  if (mode === "use" && target.entityType === "enterprise_system") return "uses_system"
  if (mode === "use") return "uses_tool"
  if (mode === "report") return "reports_to"
  return "delegates_to"
}

function modeLabelKo(
  mode: TopologyRelationModeId,
  relationType: EnterpriseRelationType,
  catalog?: TopologyRelationTemplateCatalog | null,
): string {
  if (mode === "next") return "다음"
  if (mode === "delegate") return "위임"
  if (mode === "approve") return "승인"
  if (mode === "use") return "사용"
  if (mode === "report") return "보고"
  return relationPreset(catalog, relationType)?.labelKo ?? relationType
}

export function relationLayerForType(
  relationType: EnterpriseRelationType,
  catalog?: TopologyRelationTemplateCatalog | null,
): TopologyRelationLayer {
  return relationPreset(catalog, relationType)?.layer ?? "analysis"
}

export function isRuntimeRelationCandidate(
  relationType: EnterpriseRelationType,
  catalog?: TopologyRelationTemplateCatalog | null,
): boolean {
  return relationPreset(catalog, relationType)?.runtimeCandidate === true
}

export function relationModeClassName(
  relationType: EnterpriseRelationType,
  catalog?: TopologyRelationTemplateCatalog | null,
): string {
  const layer = relationLayerForType(relationType, catalog)
  if (layer === "runtime") return "enterprise-relation-runtime-path"
  if (layer === "authority") return "enterprise-relation-authority"
  if (layer === "technical") return "enterprise-relation-technical"
  return "enterprise-relation-analysis"
}

export function relationModeStyle(
  relationType: EnterpriseRelationType,
  catalog?: TopologyRelationTemplateCatalog | null,
): { stroke: string; strokeWidth: number; strokeDasharray?: string } {
  const layer = relationLayerForType(relationType, catalog)
  if (layer === "runtime") return { stroke: "#0284c7", strokeWidth: 2.4 }
  if (layer === "authority") return { stroke: "#be123c", strokeWidth: 2, strokeDasharray: "6 4" }
  if (layer === "technical") return { stroke: "#b45309", strokeWidth: 2 }
  return { stroke: "#78716c", strokeWidth: 1.6, strokeDasharray: "4 4" }
}

export function isRelationEndpointAllowed(
  catalog: TopologyRelationTemplateCatalog | null | undefined,
  relationType: EnterpriseRelationType,
  from: EnterpriseEntityType,
  to: EnterpriseEntityType,
): boolean {
  return relationPreset(catalog, relationType)?.allowedPairs.some((pair) => pair.from === from && pair.to === to) === true
}

export function suggestRelationTypes(
  catalog: TopologyRelationTemplateCatalog | null | undefined,
  from: EnterpriseEntityType,
  to: EnterpriseEntityType,
): EnterpriseRelationType[] {
  return (catalog?.presets ?? FALLBACK_RELATION_TEMPLATE_CATALOG.presets)
    .filter((preset) => preset.allowedPairs.some((pair) => pair.from === from && pair.to === to))
    .map((preset) => preset.relationType)
}

function relationId(input: {
  relationType: EnterpriseRelationType
  source: EnterpriseEntityRef
  target: EnterpriseEntityRef
  index: number
}): string {
  const source = `${input.source.entityType}-${input.source.id}`.replace(/[^a-zA-Z0-9_-]+/g, "-")
  const target = `${input.target.entityType}-${input.target.id}`.replace(/[^a-zA-Z0-9_-]+/g, "-")
  return `relation:${input.relationType}:${source}:${target}:${input.index}`
}

export function buildEnterpriseTopologyRelationDraft(input: {
  topology: EnterpriseTopology
  sourceNodeId: string
  targetNodeId: string
  relationType?: EnterpriseRelationType
  relationMode?: TopologyRelationModeId
  catalog?: TopologyRelationTemplateCatalog | null
  now?: EnterpriseTimestamp
}): EnterpriseRelationDraftResult {
  const source = parseCanvasNodeRef(input.sourceNodeId)
  const target = parseCanvasNodeRef(input.targetNodeId)
  const requestedMode = input.relationMode ?? input.relationType ?? "smart_connect"
  if (!source || !target) {
    return {
      ok: false,
      issue: {
        reasonCode: "unknown_relation_endpoint",
        severity: "blocked",
        relationMode: requestedMode,
        ...(input.relationType !== undefined ? { relationType: input.relationType } : {}),
        message: "Relation endpoint cannot be resolved from canvas node ids.",
        suggestedRelationTypes: [],
        suggestedModes: [],
      },
    }
  }

  const sourceEndpoint = endpointForRef(input.topology, source)
  const targetEndpoint = endpointForRef(input.topology, target)
  let relationSource = source
  let relationTarget = target
  let relationType: EnterpriseRelationType | undefined = input.relationType
  let relationMode = requestedMode
  let label = ""

  if (requestedMode === "smart_connect") {
    const recommendation = recommendTopologyRelationMode({
      source: sourceEndpoint,
      target: targetEndpoint,
      catalog: input.catalog,
    })
    if (!recommendation) {
      return {
        ok: false,
        issue: {
          reasonCode: "no_smart_relation",
          severity: "blocked",
          relationMode: requestedMode,
          sourceEntityType: source.entityType,
          targetEntityType: target.entityType,
          message: `Smart Connect cannot connect ${source.entityType} to ${target.entityType}.`,
          suggestedRelationTypes: [
            ...suggestRelationTypes(input.catalog, source.entityType, target.entityType),
            ...suggestRelationTypes(input.catalog, target.entityType, source.entityType),
          ],
          suggestedModes: [],
        },
      }
    }
    relationType = recommendation.relationType
    label = recommendation.labelKo
    relationMode = recommendation.easyMode === "group" ? "smart_connect" : recommendation.easyMode
    if (recommendation.direction === "target_to_source") {
      relationSource = target
      relationTarget = source
    }
  } else if (isEasyRelationMode(requestedMode)) {
    relationType = easyModeRelationType(requestedMode, sourceEndpoint, targetEndpoint)
    label = modeLabelKo(requestedMode, relationType, input.catalog)
  } else if (isRawRelationMode(requestedMode)) {
    relationType = requestedMode
    label = modeLabelKo(requestedMode, relationType, input.catalog)
  }

  const resolvedRelationType = relationType ?? "delegates_to"
  const suggestions = suggestRelationTypes(input.catalog, relationSource.entityType, relationTarget.entityType)
  if (!isRelationEndpointAllowed(input.catalog, resolvedRelationType, relationSource.entityType, relationTarget.entityType)) {
    return {
      ok: false,
      issue: {
        reasonCode: "invalid_relation_endpoint",
        severity: "blocked",
        relationType: resolvedRelationType,
        relationMode,
        sourceEntityType: relationSource.entityType,
        targetEntityType: relationTarget.entityType,
        message: `${resolvedRelationType} cannot connect ${relationSource.entityType} to ${relationTarget.entityType}.`,
        suggestedRelationTypes: suggestions,
        suggestedModes: suggestions.map((candidate) => relationModeForSuggestion(candidate)),
      },
    }
  }

  const now = input.now ?? Date.now()
  const draft = structuredClone(input.topology)
  const preset = relationPreset(input.catalog, resolvedRelationType)
  const relation: EnterpriseRelation = {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "relation",
    id: relationId({
      relationType: resolvedRelationType,
      source: relationSource,
      target: relationTarget,
      index: draft.relations.length + 1,
    }),
    name: label || preset?.labelKo || resolvedRelationType,
    label: label || preset?.labelKo || resolvedRelationType,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    relationType: resolvedRelationType,
    from: relationSource,
    to: relationTarget,
    scope: {
      relationMode,
      smartConnect: requestedMode === "smart_connect",
    },
  }
  draft.updatedAt = now
  draft.relations.push(relation)
  return {
    ok: true,
    topology: draft,
    relation,
    layer: relationLayerForType(resolvedRelationType, input.catalog),
    runtimeCandidate: isRuntimeRelationCandidate(resolvedRelationType, input.catalog),
  }
}

function relationModeForSuggestion(relationType: EnterpriseRelationType): TopologyRelationModeId {
  if (relationType === "delegates_to") return "delegate"
  if (relationType === "approves") return "approve"
  if (relationType === "uses_tool" || relationType === "uses_system") return "use"
  if (relationType === "reports_to") return "report"
  return relationType
}

export function RelationModeToolbar({
  catalog,
  selectedRelationType,
  selectedRelationMode,
  onSelectRelationType,
  onSelectRelationMode,
  issue,
}: {
  catalog?: TopologyRelationTemplateCatalog | null
  selectedRelationType?: EnterpriseRelationType
  selectedRelationMode?: TopologyRelationModeId
  onSelectRelationType?: (relationType: EnterpriseRelationType) => void
  onSelectRelationMode?: (relationMode: TopologyRelationModeId) => void
  issue?: EnterpriseRelationModeIssue | null
}) {
  const { text } = useUiI18n()
  const { more } = splitRelationTemplateCatalog(catalog)
  const activeMode = selectedRelationMode ?? selectedRelationType ?? "smart_connect"
  const activeRelationType = isRawRelationMode(activeMode)
    ? activeMode
    : isEasyRelationMode(activeMode)
      ? easyModeRelationType(activeMode, { entityType: "node" }, { entityType: "node" })
      : selectedRelationType
  const selectMode = (mode: TopologyRelationModeId) => {
    onSelectRelationMode?.(mode)
    if (isRawRelationMode(mode)) onSelectRelationType?.(mode)
    if (mode === "next" || mode === "delegate") onSelectRelationType?.("delegates_to")
    if (mode === "approve") onSelectRelationType?.("approves")
    if (mode === "use") onSelectRelationType?.("uses_tool")
    if (mode === "report") onSelectRelationType?.("reports_to")
  }
  const runtimeCandidate = activeRelationType !== undefined && isRuntimeRelationCandidate(activeRelationType, catalog)

  return (
    <section
      className="border-b border-stone-200 bg-white px-3 py-2"
      data-testid="enterprise-relation-mode-toolbar"
      data-active-relation-type={activeRelationType ?? ""}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-400">
          {text("연결", "Connect")}
        </span>
        <button
          type="button"
          onClick={() => selectMode("smart_connect")}
          data-testid="relation-mode-smart-connect"
          className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold ${
            activeMode === "smart_connect"
              ? "border-sky-300 bg-sky-50 text-sky-800"
              : "border-stone-200 bg-white text-stone-700"
          }`}
        >
          Smart Connect
        </button>
        {EASY_RELATION_MODES.map((mode) => (
          <button
            key={mode.modeId}
            type="button"
            onClick={() => selectMode(mode.modeId)}
            title={text(mode.descriptionKo, mode.descriptionEn)}
            data-testid={`relation-mode-${mode.modeId}`}
            className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold ${
              activeMode === mode.modeId
                ? "border-sky-300 bg-sky-50 text-sky-800"
                : "border-stone-200 bg-white text-stone-700"
            }`}
          >
            {text(mode.labelKo, mode.labelEn)}
          </button>
        ))}
        <label className="flex items-center gap-1.5 text-xs font-semibold text-stone-500">
          <span>{text("더보기", "More")}</span>
          <select
            value={more.some((preset) => preset.relationType === activeMode) ? activeMode : ""}
            onChange={(event) => {
              const value = event.currentTarget.value as EnterpriseRelationType
              if (value) selectMode(value)
            }}
            data-testid="enterprise-relation-more-select"
            className="h-8 rounded-md border border-stone-200 bg-white px-2 text-xs font-semibold text-stone-700"
          >
            <option value="">{text("선택", "Select")}</option>
            {more.map((preset) => (
              <option key={preset.relationType} value={preset.relationType}>
                {text(preset.labelKo, preset.labelEn)}
              </option>
            ))}
          </select>
        </label>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
          runtimeCandidate
            ? "bg-sky-100 text-sky-800"
            : "bg-stone-100 text-stone-700"
        }`}>
          {activeMode === "smart_connect"
            ? text("추천 연결", "Recommended")
            : runtimeCandidate
            ? text("실행 경로 후보", "Runtime path candidate")
            : text("분석/권한 관계", "Analysis/authority relation")}
        </span>
      </div>
      <div className="mt-1 text-[11px] leading-4 text-stone-500" data-testid="relation-mode-compile-note">
        {text(
          "Next와 Delegate는 실행 path 후보로 저장되며, Approve/Use/Report는 권한·도구·분석 관계로 구분됩니다.",
          "Next and Delegate are saved as runtime path candidates; Approve, Use, and Report are separated as authority, technical, or analysis relations.",
        )}
      </div>
      {issue ? (
        <div
          className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900"
          data-testid="enterprise-relation-mode-issue"
        >
          <div className="font-semibold">{issue.message}</div>
          {issue.suggestedModes.length > 0 || issue.suggestedRelationTypes.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {(issue.suggestedModes.length > 0 ? issue.suggestedModes : issue.suggestedRelationTypes).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => selectMode(mode)}
                  className="rounded-full bg-white px-2 py-0.5 font-semibold text-amber-800"
                >
                  {isEasyRelationMode(mode)
                    ? EASY_RELATION_MODES.find((item) => item.modeId === mode)?.labelKo ?? mode
                    : isRawRelationMode(mode)
                      ? relationPreset(catalog, mode)?.labelKo ?? mode
                      : mode}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
