import * as React from "react"
import {
  ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
  type EnterpriseEntityRef,
  type EnterpriseTimestamp,
  type EnterpriseTopology,
  type NodeType,
} from "../../contracts/enterprise-topology"
import type {
  TopologyNodeTemplatePreset,
  TopologyTemplateCatalog,
} from "../../contracts/topology-templates"
import { useUiI18n } from "../../lib/ui-i18n"

export type EnterpriseTopologyBeginnerPaletteKind =
  | "task"
  | "decision"
  | "approval"
  | "tool"
  | "data"
  | "group"

export type EnterpriseTopologyAdvancedPaletteKind =
  | "org_unit"
  | "position"
  | "person"
  | "process"
  | "authority"
  | "responsibility"

export type EnterpriseTopologyLegacyPaletteKind = "work_node" | "team" | "system"

export type EnterpriseTopologyPaletteKind =
  | EnterpriseTopologyBeginnerPaletteKind
  | EnterpriseTopologyAdvancedPaletteKind
  | EnterpriseTopologyLegacyPaletteKind

export interface EnterpriseTopologyPaletteItem {
  id: EnterpriseTopologyPaletteKind
  labelKo: string
  labelEn: string
  tone: "stone" | "sky" | "teal" | "amber" | "rose"
  group: "core" | "advanced"
  iconLabel: string
}

export interface EnterpriseTopologyPaletteCreateRequest {
  kind: EnterpriseTopologyPaletteKind
  templateId?: string
  name?: string
  now?: EnterpriseTimestamp
}

export interface EnterpriseTopologyPaletteCreateResult {
  topology: EnterpriseTopology
  entityRef: EnterpriseEntityRef
  name: string
}

export const ENTERPRISE_TOPOLOGY_KIND_LABELS: Record<EnterpriseTopologyPaletteKind, { ko: string; en: string }> = {
  task: { ko: "Task", en: "Task" },
  decision: { ko: "Decision", en: "Decision" },
  approval: { ko: "Approval", en: "Approval" },
  data: { ko: "Data", en: "Data" },
  group: { ko: "Group", en: "Group" },
  work_node: { ko: "업무 노드", en: "Work node" },
  team: { ko: "팀", en: "Team" },
  org_unit: { ko: "조직", en: "Org unit" },
  position: { ko: "직책", en: "Position" },
  person: { ko: "담당자", en: "Person" },
  process: { ko: "업무 프로세스", en: "Process" },
  system: { ko: "시스템", en: "System" },
  tool: { ko: "도구", en: "Tool" },
  authority: { ko: "승인 규칙", en: "Authority rule" },
  responsibility: { ko: "책임 매트릭스", en: "Responsibility" },
}

export const ENTERPRISE_TOPOLOGY_PALETTE: EnterpriseTopologyPaletteItem[] = [
  { id: "task", labelKo: "Task", labelEn: "Task", tone: "sky", group: "core", iconLabel: "TS" },
  { id: "decision", labelKo: "Decision", labelEn: "Decision", tone: "stone", group: "core", iconLabel: "DC" },
  { id: "approval", labelKo: "Approval", labelEn: "Approval", tone: "rose", group: "core", iconLabel: "AP" },
  { id: "tool", labelKo: "Tool", labelEn: "Tool", tone: "amber", group: "core", iconLabel: "TL" },
  { id: "data", labelKo: "Data", labelEn: "Data", tone: "teal", group: "core", iconLabel: "DT" },
  { id: "group", labelKo: "Group", labelEn: "Group", tone: "teal", group: "core", iconLabel: "GP" },
  { id: "org_unit", labelKo: "OrgUnit", labelEn: "OrgUnit", tone: "stone", group: "advanced", iconLabel: "OU" },
  { id: "position", labelKo: "직책", labelEn: "Position", tone: "stone", group: "advanced", iconLabel: "PO" },
  { id: "person", labelKo: "담당자", labelEn: "Person", tone: "stone", group: "advanced", iconLabel: "PE" },
  { id: "process", labelKo: "업무 프로세스", labelEn: "Process", tone: "sky", group: "advanced", iconLabel: "PR" },
  { id: "authority", labelKo: "승인 규칙", labelEn: "Authority rule", tone: "rose", group: "advanced", iconLabel: "AR" },
  { id: "responsibility", labelKo: "책임 매트릭스", labelEn: "Responsibility", tone: "teal", group: "advanced", iconLabel: "RA" },
]

const NAME_PREFIXES: Record<EnterpriseTopologyPaletteKind, string> = {
  task: "새 업무",
  decision: "새 결정",
  approval: "새 승인",
  data: "새 데이터",
  group: "새 그룹",
  work_node: "새 업무 노드",
  team: "새 팀",
  org_unit: "새 조직",
  position: "새 직책",
  person: "새 담당자",
  process: "새 프로세스",
  system: "새 시스템",
  tool: "새 도구",
  authority: "새 승인 규칙",
  responsibility: "새 책임 항목",
}

const ENTITY_ID_PREFIXES: Record<EnterpriseTopologyPaletteKind, string> = {
  task: "node",
  decision: "node",
  approval: "node",
  data: "system",
  group: "team",
  work_node: "node",
  team: "team",
  org_unit: "org",
  position: "position",
  person: "person",
  process: "process",
  system: "system",
  tool: "tool",
  authority: "authority",
  responsibility: "responsibility",
}

function paletteToneClassName(tone: EnterpriseTopologyPaletteItem["tone"]): string {
  if (tone === "sky") return "border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100"
  if (tone === "teal") return "border-teal-200 bg-teal-50 text-teal-800 hover:bg-teal-100"
  if (tone === "amber") return "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
  if (tone === "rose") return "border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100"
  return "border-stone-200 bg-stone-50 text-stone-700 hover:bg-stone-100"
}

function namesForKind(topology: EnterpriseTopology, kind: EnterpriseTopologyPaletteKind): string[] {
  if (kind === "task" || kind === "decision" || kind === "approval" || kind === "work_node") {
    return topology.nodes.map((entity) => entity.name)
  }
  if (kind === "group" || kind === "team") return topology.teams.map((entity) => entity.name)
  if (kind === "org_unit") return topology.orgUnits.map((entity) => entity.name)
  if (kind === "position") return topology.positions.map((entity) => entity.name)
  if (kind === "person") return topology.persons.map((entity) => entity.name)
  if (kind === "process") return topology.processes.map((entity) => entity.name)
  if (kind === "data" || kind === "system") return topology.systems.map((entity) => entity.name)
  if (kind === "tool") return topology.tools.map((entity) => entity.name)
  if (kind === "authority") return topology.authorityRules.map((entity) => entity.name)
  return topology.responsibilities.map((entity) => entity.name)
}

function countForKind(topology: EnterpriseTopology, kind: EnterpriseTopologyPaletteKind): number {
  return namesForKind(topology, kind).length
}

export function nextEnterpriseEntityName(
  kind: EnterpriseTopologyPaletteKind,
  existingNames: readonly string[],
): string {
  const prefix = NAME_PREFIXES[kind]
  let next = 1
  const used = new Set(existingNames)
  while (used.has(`${prefix} ${next}`)) next += 1
  return `${prefix} ${next}`
}

function entityId(kind: EnterpriseTopologyPaletteKind, index: number): string {
  return `${ENTITY_ID_PREFIXES[kind]}:${ENTITY_ID_PREFIXES[kind]}-${index}`
}

export function createEmptyEnterpriseTopologyForPalette(input: {
  topologyId?: string
  name?: string
  now?: EnterpriseTimestamp
} = {}): EnterpriseTopology {
  const now = input.now ?? Date.now()
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "topology",
    id: input.topologyId ?? "topology:gui-draft",
    name: input.name ?? "Enterprise topology draft",
    status: "draft",
    createdAt: now,
    updatedAt: now,
    nodes: [],
    teams: [],
    orgUnits: [],
    positions: [],
    persons: [],
    memberships: [],
    authorityRules: [],
    responsibilities: [],
    systems: [],
    tools: [],
    processes: [],
    relations: [],
  }
}

function nodeTypeForTemplate(template?: TopologyNodeTemplatePreset): NodeType {
  return template?.nodeType ?? "function"
}

function nodeDefaultsForPaletteKind(
  kind: "task" | "decision" | "approval" | "work_node",
  template?: TopologyNodeTemplatePreset,
): {
  nodeType: NodeType
  templateId: string
  tags: string[]
  successCriteria: string[]
} {
  if (kind === "decision") {
    return {
      nodeType: "decision_node",
      templateId: "topology-template:node:decision",
      tags: ["판단", "분기"],
      successCriteria: ["판단 조건 확인", "분기 결과 기록"],
    }
  }
  if (kind === "approval") {
    return {
      nodeType: "approval_node",
      templateId: "topology-template:node:approval",
      tags: ["승인"],
      successCriteria: ["승인 기준 확인", "승인 여부 기록"],
    }
  }
  return {
    nodeType: nodeTypeForTemplate(template),
    templateId: template?.id ?? "topology-template:node:general-work",
    tags: template?.expertiseChips.slice(0, 2) ?? ["업무"],
    successCriteria: template?.successCriteria ?? ["결과 요약", "후속 조치 기록"],
  }
}

export function createEnterpriseTopologyPaletteEntity(
  topology: EnterpriseTopology,
  request: EnterpriseTopologyPaletteCreateRequest,
  catalog?: TopologyTemplateCatalog | null,
): EnterpriseTopologyPaletteCreateResult {
  const draft = structuredClone(topology)
  const now = request.now ?? Date.now()
  const index = countForKind(draft, request.kind) + 1
  const template = request.templateId
    ? catalog?.nodePresets.find((candidate) => candidate.id === request.templateId)
    : catalog?.nodePresets[0]
  const name = request.name?.trim() || nextEnterpriseEntityName(request.kind, namesForKind(draft, request.kind))
  const id = entityId(request.kind, index)
  draft.updatedAt = now

  if (request.kind === "task" || request.kind === "decision" || request.kind === "approval" || request.kind === "work_node") {
    const nodeDefaults = nodeDefaultsForPaletteKind(request.kind, template)
    draft.nodes.push({
      schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
      entityType: "node",
      id,
      name,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      nodeType: nodeDefaults.nodeType,
      tags: nodeDefaults.tags,
      children: [],
      template: {
        templateId: nodeDefaults.templateId,
        source: template ? "user_preset" : "system_preset",
        fixedRoleCatalog: false,
        metadata: {
          successCriteria: nodeDefaults.successCriteria,
          outputPreset: "concise_result_summary",
        },
      },
      allowedToolIds: [],
      allowedSystemIds: [],
      failurePolicy: {
        failureReportRequired: true,
        allowPartialSuccess: true,
        fallbackNodeIds: [],
      },
      recoveryPolicy: {
        retryAllowed: false,
        redelegationAllowed: true,
        fallbackAllowed: false,
        partialSuccessAllowed: true,
      },
    })
    return { topology: draft, entityRef: { entityType: "node", id }, name }
  }

  if (request.kind === "group" || request.kind === "team") {
    draft.teams.push({
      schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
      entityType: "team",
      id,
      name,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      purpose: request.kind === "group" ? "업무 흐름 그룹" : "논리 업무 그룹",
      nodeIds: [],
      tags: [],
    })
    return { topology: draft, entityRef: { entityType: "team", id }, name }
  }

  if (request.kind === "org_unit") {
    draft.orgUnits.push({
      schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
      entityType: "org_unit",
      id,
      name,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      positionIds: [],
      personIds: [],
      kpiIds: [],
      responsibilityArea: "조직 책임 영역",
    })
    return { topology: draft, entityRef: { entityType: "org_unit", id }, name }
  }

  if (request.kind === "data" || request.kind === "system") {
    draft.systems.push({
      schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
      entityType: "enterprise_system",
      id,
      name,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      systemType: request.kind === "data" ? "data_store" : "unknown",
      dataDomainIds: [],
      criticality: "unknown",
    })
    return { topology: draft, entityRef: { entityType: "enterprise_system", id }, name }
  }

  if (request.kind === "tool") {
    draft.tools.push({
      schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
      entityType: "enterprise_tool",
      id,
      name,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      toolType: "read_only",
    })
    return { topology: draft, entityRef: { entityType: "enterprise_tool", id }, name }
  }

  if (request.kind === "position") {
    draft.positions.push({
      schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
      entityType: "position",
      id,
      name,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      orgUnitId: "",
      personIds: [],
      responsibilityIds: [],
    })
    return { topology: draft, entityRef: { entityType: "position", id }, name }
  }

  if (request.kind === "person") {
    draft.persons.push({
      schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
      entityType: "person",
      id,
      name,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      positionIds: [],
      orgUnitIds: [],
      availability: "unknown",
    })
    return { topology: draft, entityRef: { entityType: "person", id }, name }
  }

  if (request.kind === "process") {
    draft.processes.push({
      schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
      entityType: "process_definition",
      id,
      name,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      stepNodeIds: [],
    })
    return { topology: draft, entityRef: { entityType: "process_definition", id }, name }
  }

  if (request.kind === "authority") {
    draft.authorityRules.push({
      schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
      entityType: "authority_rule",
      id,
      name,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      subject: { entityType: "node", id: "" },
      action: "review",
      object: { entityType: "topology", id: draft.id },
      delegable: false,
      requiresAuditLog: true,
    })
    return { topology: draft, entityRef: { entityType: "authority_rule", id }, name }
  }

  draft.responsibilities.push({
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "responsibility_matrix_entry",
    id,
    name,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    scope: { entityType: "node", id: "" },
    responsible: { entityType: "node", id: "" },
    consulted: [],
    informed: [],
  })
  return { topology: draft, entityRef: { entityType: "responsibility_matrix_entry", id }, name }
}

function PaletteGroup({
  title,
  items,
  onCreateEntity,
  selectedTemplateId,
  showTitle = true,
}: {
  title: string
  items: EnterpriseTopologyPaletteItem[]
  onCreateEntity?: (kind: EnterpriseTopologyPaletteKind, templateId?: string) => void
  selectedTemplateId?: string
  showTitle?: boolean
}) {
  const { text } = useUiI18n()
  return (
    <div className="grid gap-2">
      {showTitle ? (
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400">{title}</div>
      ) : null}
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onCreateEntity?.(item.id, item.id === "task" || item.id === "work_node" ? selectedTemplateId : undefined)}
          disabled={!onCreateEntity}
          data-testid={`enterprise-palette-create-${item.id}`}
          className={`min-h-10 rounded-lg border px-3 text-left text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-70 ${paletteToneClassName(item.tone)}`}
        >
          <span className="flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-white/70 text-[10px] font-bold" aria-hidden="true">
              {item.iconLabel}
            </span>
            <span>{text(item.labelKo, item.labelEn)}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

export function EnterpriseTopologyPalette({
  items = ENTERPRISE_TOPOLOGY_PALETTE,
  templateCatalog,
  onCreateEntity,
}: {
  items?: EnterpriseTopologyPaletteItem[]
  templateCatalog?: TopologyTemplateCatalog | null
  onCreateEntity?: (kind: EnterpriseTopologyPaletteKind, templateId?: string) => void
}) {
  const { text } = useUiI18n()
  const nodePresets = templateCatalog?.nodePresets ?? []
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<string | undefined>(nodePresets[0]?.id)
  const coreItems = items.filter((item) => item.group === "core")
  const advancedItems = items.filter((item) => item.group === "advanced")

  React.useEffect(() => {
    if (selectedTemplateId === undefined && nodePresets[0]) setSelectedTemplateId(nodePresets[0].id)
  }, [nodePresets, selectedTemplateId])

  return (
    <aside
      className="min-h-0 overflow-y-auto rounded-lg border border-stone-200 bg-white p-4"
      data-testid="enterprise-topology-palette"
    >
      <div className="grid gap-3">
        <PaletteGroup
          title={text("기본", "Core")}
          items={coreItems}
          onCreateEntity={onCreateEntity}
          selectedTemplateId={selectedTemplateId}
        />
        <details className="rounded-lg border border-stone-200 bg-stone-50 p-3" data-testid="enterprise-palette-task-presets">
          <summary className="cursor-pointer text-xs font-semibold text-stone-700">
            {text("Task preset", "Task preset")}
          </summary>
          <div className="mt-2 grid gap-1.5">
            {nodePresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setSelectedTemplateId(preset.id)}
                data-testid={`enterprise-template-${preset.id}`}
                className={`rounded-md border px-2.5 py-2 text-left text-xs font-semibold ${
                  selectedTemplateId === preset.id
                    ? "border-sky-300 bg-white text-sky-800"
                    : "border-stone-200 bg-white text-stone-700"
                }`}
              >
                <span>{text(preset.labelKo, preset.labelEn)}</span>
                <span className="mt-0.5 block font-normal text-stone-500">
                  {text(preset.descriptionKo, preset.descriptionEn)}
                </span>
              </button>
            ))}
            {nodePresets.length === 0 ? (
              <div className="rounded-md border border-dashed border-stone-200 bg-white px-2.5 py-2 text-xs text-stone-500">
                {text("기본 preset으로 시작", "Start with default preset")}
              </div>
            ) : null}
          </div>
        </details>
        <details className="rounded-lg border border-stone-200 bg-stone-50 p-3" data-testid="enterprise-palette-advanced">
          <summary className="cursor-pointer text-xs font-semibold text-stone-700">
            {text("고급", "Advanced")}
          </summary>
          <div className="mt-2">
            <PaletteGroup
              title={text("고급", "Advanced")}
              items={advancedItems}
              onCreateEntity={onCreateEntity}
              selectedTemplateId={selectedTemplateId}
              showTitle={false}
            />
          </div>
        </details>
      </div>
    </aside>
  )
}
