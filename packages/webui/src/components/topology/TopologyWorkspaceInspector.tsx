import * as React from "react"
import type {
  EnterpriseMetadataValue,
  EnterpriseTimestamp,
  NodeContract,
} from "../../contracts/enterprise-topology"
import type { AgentTopologyNode, AgentTopologyProjection } from "../../contracts/topology"
import type { TopologyTemplateCatalog } from "../../contracts/topology-templates"
import { useUiI18n } from "../../lib/ui-i18n"
import type { EnterpriseTopologyCanvasNodeData } from "./EnterpriseTopologyCanvas"

const TOPOLOGY_WORKSPACE_KIND_LABELS: Record<EnterpriseTopologyCanvasNodeData["kind"], { ko: string; en: string }> = {
  task: { ko: "실행자", en: "Executor" },
  decision: { ko: "판단 실행자", en: "Decision executor" },
  approval: { ko: "최종 검토", en: "Final review" },
  data: { ko: "데이터", en: "Data" },
  group: { ko: "그룹", en: "Group" },
  work_node: { ko: "실행자", en: "Executor" },
  team: { ko: "팀", en: "Team" },
  org_unit: { ko: "조직", en: "Org unit" },
  position: { ko: "직책", en: "Position" },
  person: { ko: "담당자", en: "Person" },
  process: { ko: "프로세스", en: "Process" },
  system: { ko: "시스템", en: "System" },
  tool: { ko: "도구", en: "Tool" },
  authority: { ko: "승인 규칙", en: "Authority rule" },
  responsibility: { ko: "책임", en: "Responsibility" },
}

export type TopologyWorkspaceExecutorKind =
  | "nobie"
  | "agent"
  | "team"
  | "tool"
  | "manual_approval"

export interface TopologyWorkspaceExecutorMapping {
  schemaVersion: 1
  sourceOfTruth: "enterprise_node"
  executorKind: TopologyWorkspaceExecutorKind
  executorId: string
  runtimeProfileRef: string
  createsAgentConfig: false
  selectedAt?: EnterpriseTimestamp
}

export interface TopologyWorkspaceExecutorOption {
  kind: TopologyWorkspaceExecutorKind
  labelKo: string
  labelEn: string
  descriptionKo: string
  descriptionEn: string
  defaultExecutorId: string
}

export interface TopologyWorkspaceRuntimeExecutorResourceOption {
  kind: Extract<TopologyWorkspaceExecutorKind, "agent" | "team">
  executorId: string
  label: string
  description: string
  status: string
  modelSummary: string
}

export const TOPOLOGY_WORKSPACE_EXECUTOR_OPTIONS: TopologyWorkspaceExecutorOption[] = [
  {
    kind: "nobie",
    labelKo: "자동 처리",
    labelEn: "Auto processing",
    descriptionKo: "노비가 기본 실행자로 업무를 처리합니다.",
    descriptionEn: "Nobie handles this step with the default executor.",
    defaultExecutorId: "nobie:default",
  },
  {
    kind: "agent",
    labelKo: "기존 실행자 사용",
    labelEn: "Use existing executor",
    descriptionKo: "이미 등록된 실행자를 이 업무에만 연결합니다.",
    descriptionEn: "Link an existing executor only to this step.",
    defaultExecutorId: "agent:select-existing",
  },
  {
    kind: "team",
    labelKo: "기존 실행자 사용",
    labelEn: "Use existing executor",
    descriptionKo: "이미 등록된 실행자 그룹이 이 업무를 처리합니다.",
    descriptionEn: "An existing executor group handles this step.",
    defaultExecutorId: "team:select-existing",
  },
  {
    kind: "tool",
    labelKo: "도구 실행",
    labelEn: "Tool execution",
    descriptionKo: "도구 실행으로 처리되는 자동화 단계입니다.",
    descriptionEn: "This step is executed through a tool.",
    defaultExecutorId: "tool:select-existing",
  },
  {
    kind: "manual_approval",
    labelKo: "최종 검토",
    labelEn: "Final review",
    descriptionKo: "중간 실행은 자동 흐름으로 두고 최종 결과 검토에만 사용합니다.",
    descriptionEn: "Keep intermediate execution automatic and use review only at the final result stage.",
    defaultExecutorId: "manual:approval-required",
  },
]

function runtimeExecutorKindForResource(node: AgentTopologyNode): TopologyWorkspaceRuntimeExecutorResourceOption["kind"] | null {
  if (node.kind === "team") return "team"
  if (node.kind === "nobie" || node.kind === "sub_agent") return "agent"
  return null
}

function summarizeRuntimeExecutorModel(
  projection: AgentTopologyProjection,
  node: AgentTopologyNode,
): string {
  const agent = projection.inspectors.agents[node.entityId]
  if (agent) {
    const model = [agent.model.providerId, agent.model.modelId].filter(Boolean).join("/")
    return model || agent.model.availability || "model unknown"
  }
  const team = projection.inspectors.teams[node.entityId]
  if (team) {
    return `${team.health.activeMemberCount}/${team.health.referenceMemberCount} active members`
  }
  return "model unknown"
}

function summarizeRuntimeExecutorDescription(
  projection: AgentTopologyProjection,
  node: AgentTopologyNode,
): string {
  const agent = projection.inspectors.agents[node.entityId]
  if (agent) {
    const capability = agent.capability.availability ?? "unknown"
    return `${agent.status} · capability ${capability} · tools ${agent.tools.enabledCount}`
  }
  const team = projection.inspectors.teams[node.entityId]
  if (team) {
    return `${team.health.status} · ${team.health.activeMemberCount}/${team.health.referenceMemberCount} active`
  }
  return `${node.kind} · ${node.status ?? "unknown"}`
}

export function buildTopologyWorkspaceRuntimeExecutorResourceOptions(
  runtimeResources?: AgentTopologyProjection | null,
): TopologyWorkspaceRuntimeExecutorResourceOption[] {
  if (!runtimeResources) return []
  return runtimeResources.nodes
    .map((node) => {
      const kind = runtimeExecutorKindForResource(node)
      if (!kind) return null
      return {
        kind,
        executorId: node.entityId,
        label: node.label,
        description: summarizeRuntimeExecutorDescription(runtimeResources, node),
        status: node.status ?? "unknown",
        modelSummary: summarizeRuntimeExecutorModel(runtimeResources, node),
      } satisfies TopologyWorkspaceRuntimeExecutorResourceOption
    })
    .filter((option): option is TopologyWorkspaceRuntimeExecutorResourceOption => Boolean(option))
}

function normalizeRuntimeProfilePart(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9:_-]+/g, "-") || "default"
}

export function buildTopologyWorkspaceExecutorMapping(input: {
  nodeId: string
  executorKind: TopologyWorkspaceExecutorKind
  executorId?: string
  runtimeProfileRef?: string
  selectedAt?: EnterpriseTimestamp
}): TopologyWorkspaceExecutorMapping {
  const option = TOPOLOGY_WORKSPACE_EXECUTOR_OPTIONS.find((item) => item.kind === input.executorKind)
  const executorId = input.executorId ?? option?.defaultExecutorId ?? `${input.executorKind}:default`
  const nodePart = normalizeRuntimeProfilePart(input.nodeId)
  const executorPart = normalizeRuntimeProfilePart(executorId)
  return {
    schemaVersion: 1,
    sourceOfTruth: "enterprise_node",
    executorKind: input.executorKind,
    executorId,
    runtimeProfileRef: input.runtimeProfileRef ?? `runtime-profile:${nodePart}:${input.executorKind}:${executorPart}`,
    createsAgentConfig: false,
    ...(input.selectedAt !== undefined ? { selectedAt: input.selectedAt } : {}),
  }
}

function executorMappingMetadataValue(mapping: TopologyWorkspaceExecutorMapping): EnterpriseMetadataValue {
  return {
    schemaVersion: mapping.schemaVersion,
    sourceOfTruth: mapping.sourceOfTruth,
    executorKind: mapping.executorKind,
    executorId: mapping.executorId,
    runtimeProfileRef: mapping.runtimeProfileRef,
    createsAgentConfig: mapping.createsAgentConfig,
    ...(mapping.selectedAt !== undefined ? { selectedAt: mapping.selectedAt } : {}),
  }
}

export function applyTopologyWorkspaceExecutorMappingToNode(
  node: NodeContract,
  mapping: TopologyWorkspaceExecutorMapping,
): NodeContract {
  return {
    ...node,
    metadata: {
      ...node.metadata,
      runtimeExecutor: executorMappingMetadataValue(mapping),
      runtimeProfileRef: mapping.runtimeProfileRef,
      runtimeSourceOfTruth: "enterprise_node",
    },
  }
}

function isRecord(value: EnterpriseMetadataValue | undefined): value is Record<string, EnterpriseMetadataValue | undefined> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function isTopologyWorkspaceExecutorKind(value: EnterpriseMetadataValue | undefined): value is TopologyWorkspaceExecutorKind {
  return typeof value === "string" && TOPOLOGY_WORKSPACE_EXECUTOR_OPTIONS.some((item) => item.kind === value)
}

export function readTopologyWorkspaceExecutorMappingFromNode(
  node?: NodeContract | null,
): TopologyWorkspaceExecutorMapping | null {
  const value = node?.metadata?.runtimeExecutor
  if (!isRecord(value) || !isTopologyWorkspaceExecutorKind(value.executorKind)) return null
  const runtimeProfileRef = typeof value.runtimeProfileRef === "string"
    ? value.runtimeProfileRef
    : typeof node?.metadata?.runtimeProfileRef === "string"
      ? node.metadata.runtimeProfileRef
      : null
  const executorId = typeof value.executorId === "string" ? value.executorId : null
  if (!runtimeProfileRef || !executorId) return null
  return {
    schemaVersion: 1,
    sourceOfTruth: "enterprise_node",
    executorKind: value.executorKind,
    executorId,
    runtimeProfileRef,
    createsAgentConfig: false,
    ...(typeof value.selectedAt === "string" || typeof value.selectedAt === "number" ? { selectedAt: value.selectedAt } : {}),
  }
}

function statusToneClassName(status: EnterpriseTopologyCanvasNodeData["status"]): string {
  if (status === "active") return "bg-emerald-100 text-emerald-800"
  if (status === "inactive") return "bg-stone-100 text-stone-600"
  if (status === "archived") return "bg-red-100 text-red-700"
  return "bg-sky-100 text-sky-700"
}

function InspectorField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-stone-200 bg-stone-50 px-2.5 py-2">
      <div className="text-[11px] font-semibold uppercase text-stone-500">{label}</div>
      <div className="mt-0.5 break-all text-xs font-semibold text-stone-900">{value}</div>
    </div>
  )
}

function ButtonChoiceRow({
  label,
  choices,
  selected,
  testId,
}: {
  label: string
  choices: string[]
  selected?: string
  testId?: string
}) {
  return (
    <div data-testid={testId}>
      <div className="text-[11px] font-semibold uppercase text-stone-500">{label}</div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {choices.map((choice) => {
          const active = choice === selected
          return (
            <button
              key={choice}
              type="button"
              className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold ${
                active
                  ? "border-stone-900 bg-stone-900 text-white"
                  : "border-stone-200 bg-white text-stone-700"
              }`}
            >
              {choice}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function CheckboxChoiceRow({
  label,
  choices,
  testId,
}: {
  label: string
  choices: string[]
  testId?: string
}) {
  return (
    <div data-testid={testId}>
      <div className="text-[11px] font-semibold uppercase text-stone-500">{label}</div>
      <div className="mt-1.5 grid gap-1.5">
        {choices.map((choice) => (
          <label
            key={choice}
            className="flex min-h-8 items-center gap-2 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-stone-700"
          >
            <input type="checkbox" className="h-3.5 w-3.5 rounded border-stone-300 text-sky-600" defaultChecked />
            <span>{choice}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

function SectionShell({
  title,
  children,
  testId,
}: {
  title: string
  children: React.ReactNode
  testId?: string
}) {
  return (
    <section className="rounded-md border border-stone-200 bg-white p-3" data-testid={testId}>
      <div className="text-xs font-semibold text-stone-950">{title}</div>
      <div className="mt-2 grid gap-2.5">{children}</div>
    </section>
  )
}

export function TopologyWorkspaceExecutorPicker({
  selectedData,
  mapping,
  runtimeResources,
  onExecutorMappingChange,
}: {
  selectedData: EnterpriseTopologyCanvasNodeData
  mapping?: TopologyWorkspaceExecutorMapping | null
  runtimeResources?: AgentTopologyProjection | null
  onExecutorMappingChange?: (nodeId: string, mapping: TopologyWorkspaceExecutorMapping) => void
}) {
  const { text } = useUiI18n()
  const selectedKind = mapping?.executorKind ?? "nobie"
  const canPersist = selectedData.entityType === "node"
  const resourceOptions = React.useMemo(
    () => buildTopologyWorkspaceRuntimeExecutorResourceOptions(runtimeResources),
    [runtimeResources],
  )

  return (
    <SectionShell title={text("실행자 선택", "Executor")} testId="topology-workspace-executor-picker">
      <div className="grid gap-1.5">
        {TOPOLOGY_WORKSPACE_EXECUTOR_OPTIONS.map((option) => {
          const active = option.kind === selectedKind && (!mapping || mapping.executorId === option.defaultExecutorId)
          return (
            <button
              key={option.kind}
              type="button"
              disabled={!canPersist}
              onClick={() => {
                if (!canPersist) return
                onExecutorMappingChange?.(
                  selectedData.entityId,
                  buildTopologyWorkspaceExecutorMapping({
                    nodeId: selectedData.entityId,
                    executorKind: option.kind,
                    selectedAt: Date.now(),
                  }),
                )
              }}
              className={`min-h-9 rounded-md border px-2.5 py-2 text-left text-xs disabled:cursor-not-allowed disabled:opacity-60 ${
                active
                  ? "border-sky-300 bg-sky-50 text-sky-950"
                  : "border-stone-200 bg-white text-stone-700"
              }`}
              data-testid={`topology-workspace-executor-${option.kind}`}
            >
              <span className="font-semibold">{text(option.labelKo, option.labelEn)}</span>
              <span className="mt-0.5 block leading-4 text-stone-500">
                {text(option.descriptionKo, option.descriptionEn)}
              </span>
            </button>
          )
        })}
      </div>
      {resourceOptions.length > 0 ? (
        <div className="grid gap-1.5" data-testid="topology-workspace-executor-resource-options">
          <div className="text-[11px] font-semibold uppercase text-stone-500">
            {text("기존 실행 리소스", "Existing runtime resources")}
          </div>
          {resourceOptions.map((resource) => {
            const active = mapping?.executorId === resource.executorId
            return (
              <button
                key={`${resource.kind}:${resource.executorId}`}
                type="button"
                disabled={!canPersist}
                onClick={() => {
                  if (!canPersist) return
                  onExecutorMappingChange?.(
                    selectedData.entityId,
                    buildTopologyWorkspaceExecutorMapping({
                      nodeId: selectedData.entityId,
                      executorKind: resource.kind,
                      executorId: resource.executorId,
                      selectedAt: Date.now(),
                    }),
                  )
                }}
                className={`min-h-9 rounded-md border px-2.5 py-2 text-left text-xs disabled:cursor-not-allowed disabled:opacity-60 ${
                  active
                    ? "border-emerald-300 bg-emerald-50 text-emerald-950"
                    : "border-stone-200 bg-white text-stone-700"
                }`}
                data-testid={`topology-workspace-executor-resource-${resource.kind}`}
                data-executor-id={resource.executorId}
              >
                <span className="font-semibold">{resource.label}</span>
                <span className="ml-2 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase text-stone-500">
                  {resource.kind}
                </span>
                <span className="mt-0.5 block leading-4 text-stone-500">
                  {resource.description} · {resource.modelSummary}
                </span>
              </button>
            )
          })}
        </div>
      ) : null}
      <div className="rounded-md border border-stone-200 bg-stone-50 px-2.5 py-2 text-xs leading-5 text-stone-600">
        {canPersist
          ? text(
            "선택은 NodeContract의 runtime profile reference로만 저장됩니다. AgentConfig나 Team은 원본으로 생성하지 않습니다.",
            "The choice is stored only as a NodeContract runtime profile reference. AgentConfig or Team is not created as source of truth.",
          )
          : text(
            "Tool/Data/Group은 실행자가 아니라 업무에서 참조하는 리소스입니다.",
            "Tool/Data/Group is a referenced resource, not an executor source.",
          )}
      </div>
    </SectionShell>
  )
}

function TaskSettings({ templateCatalog }: { templateCatalog?: TopologyTemplateCatalog | null }) {
  const { text } = useUiI18n()
  const nodePresets = templateCatalog?.nodePresets ?? []
  const criteria = templateCatalog?.successCriteriaPresets.slice(0, 3) ?? [
    text("요청 범위 확인", "Confirm request scope"),
    text("결과 요약", "Summarize result"),
    text("후속 조치 기록", "Record follow-up"),
  ]

  return (
    <SectionShell title={text("Task 설정", "Task settings")} testId="topology-workspace-task-settings">
      <ButtonChoiceRow
        label={text("Template picker", "Template picker")}
        choices={nodePresets.length > 0
          ? nodePresets.map((preset) => text(preset.labelKo, preset.labelEn))
          : [text("일반 업무", "General work"), text("조사 업무", "Research work"), text("응답 정리", "Response summary")]}
        selected={nodePresets[0] ? text(nodePresets[0].labelKo, nodePresets[0].labelEn) : text("일반 업무", "General work")}
      />
      <ButtonChoiceRow
        label={text("Output preset", "Output preset")}
        choices={[
          text("짧은 결과 요약", "Concise result summary"),
          text("체크리스트 결과", "Checklist result"),
          text("구조화 결과", "Structured result"),
        ]}
        selected={text("짧은 결과 요약", "Concise result summary")}
      />
      <CheckboxChoiceRow
        label={text("완료 기준", "Success checklist")}
        choices={criteria}
      />
      <CheckboxChoiceRow
        label={text("허용 도구/데이터", "Allowed tools and data")}
        choices={[
          "CRM Search",
          text("고객 데이터", "Customer data"),
          text("문서 저장소", "Document store"),
        ]}
      />
    </SectionShell>
  )
}

function DecisionSettings() {
  const { text } = useUiI18n()
  return (
    <SectionShell title={text("Decision 설정", "Decision settings")} testId="topology-workspace-decision-settings">
      <ButtonChoiceRow
        label={text("Condition preset", "Condition preset")}
        choices={[
          text("정보 충분", "Information enough"),
          text("검토 필요", "Review needed"),
          text("위험도 높음", "High risk"),
        ]}
        selected={text("정보 충분", "Information enough")}
      />
      <ButtonChoiceRow
        label={text("Branch label preset", "Branch label preset")}
        choices={[
          text("통과 / 보류", "Pass / Hold"),
          text("승인 / 반려", "Approve / Reject"),
          text("성공 / 실패", "Success / Failure"),
        ]}
        selected={text("통과 / 보류", "Pass / Hold")}
      />
    </SectionShell>
  )
}

function ApprovalSettings() {
  const { text } = useUiI18n()
  return (
    <SectionShell title={text("Approval 설정", "Approval settings")} testId="topology-workspace-approval-settings">
      <ButtonChoiceRow
        label={text("Approver position picker", "Approver position picker")}
        choices={[
          text("담당 리드", "Responsible lead"),
          text("조직 관리자", "Org manager"),
          text("백업 승인자", "Backup approver"),
        ]}
        selected={text("담당 리드", "Responsible lead")}
      />
      <ButtonChoiceRow
        label={text("Threshold preset", "Threshold preset")}
        choices={[
          text("1명 승인", "One approval"),
          text("2명 중 1명", "One of two"),
          text("고위험은 관리자", "Manager for high risk"),
        ]}
        selected={text("1명 승인", "One approval")}
      />
    </SectionShell>
  )
}

function ToolDataSettings({ kind }: { kind: "data" | "system" | "tool" }) {
  const { text } = useUiI18n()
  const isTool = kind === "tool"
  return (
    <SectionShell title={isTool ? text("Tool 설정", "Tool settings") : text("Data 설정", "Data settings")} testId="topology-workspace-tool-settings">
      <ButtonChoiceRow
        label={isTool ? text("Tool picker", "Tool picker") : text("System picker", "System picker")}
        choices={isTool
          ? ["CRM Search", text("메일 발송", "Send mail"), text("문서 검색", "Document search")]
          : [text("고객 데이터", "Customer data"), text("문서 저장소", "Document store"), text("운영 DB", "Operations DB")]}
        selected={isTool ? "CRM Search" : text("고객 데이터", "Customer data")}
      />
      <ButtonChoiceRow
        label={text("Permission mode", "Permission mode")}
        choices={[
          text("조회 전용", "Read-only"),
          text("승인 후 쓰기", "Write after approval"),
          text("차단", "Blocked"),
        ]}
        selected={text("조회 전용", "Read-only")}
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <ButtonChoiceRow
          label={text("Retry preset", "Retry preset")}
          choices={[text("없음", "None"), text("1회", "Once"), text("3회", "Three times")]}
          selected={text("1회", "Once")}
        />
        <ButtonChoiceRow
          label={text("Timeout preset", "Timeout preset")}
          choices={["15s", "60s", "5m"]}
          selected="60s"
        />
      </div>
    </SectionShell>
  )
}

function GroupSettings({ officialOrg = false }: { officialOrg?: boolean }) {
  const { text } = useUiI18n()
  return (
    <SectionShell title={officialOrg ? text("조직 필드", "Organization fields") : text("팀 필드", "Team fields")} testId="topology-workspace-group-settings">
      <ButtonChoiceRow
        label={text("Group kind", "Group kind")}
        choices={[text("Team", "Team"), text("Org", "Org")]}
        selected={officialOrg ? text("Org", "Org") : text("Team", "Team")}
      />
      <CheckboxChoiceRow
        label={text("Member picker", "Member picker")}
        choices={[
          text("담당자", "Owner"),
          text("검토자", "Reviewer"),
          text("승인자", "Approver"),
        ]}
      />
      <CheckboxChoiceRow
        label={officialOrg ? text("책임 영역", "Responsibility area") : text("Responsibility tags", "Responsibility tags")}
        choices={[
          text("책임 영역", "Responsibility area"),
          text("상위 조직", "Parent org unit"),
          text("논리 그룹", "Logical group"),
        ]}
      />
      <div className="rounded-md border border-stone-200 bg-stone-50 px-2.5 py-2 text-xs leading-5 text-stone-600">
        {officialOrg
          ? text("OrgUnit은 공식 조직 구조와 책임 영역을 표현합니다.", "OrgUnit represents formal structure and responsibility areas.")
          : text("Team은 논리 그룹입니다. 공식 조직 구조는 OrgUnit에서 관리합니다.", "Teams are logical groups. Formal organization structure belongs to OrgUnit.")}
      </div>
    </SectionShell>
  )
}

function GenericSettings() {
  const { text } = useUiI18n()
  return (
    <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-xs leading-5 text-stone-600">
      {text("고급 엔티티는 관계 모드와 validator 연결 후 상세 편집합니다.", "Advanced entities are edited after relation mode and validator wiring.")}
    </div>
  )
}

function SettingsForSelection({
  selectedData,
  templateCatalog,
}: {
  selectedData: EnterpriseTopologyCanvasNodeData
  templateCatalog?: TopologyTemplateCatalog | null
}) {
  if (selectedData.kind === "task" || selectedData.kind === "work_node") {
    return <TaskSettings templateCatalog={templateCatalog} />
  }
  if (selectedData.kind === "decision") return <DecisionSettings />
  if (selectedData.kind === "approval") return <ApprovalSettings />
  if (selectedData.kind === "tool" || selectedData.kind === "data" || selectedData.kind === "system") {
    return <ToolDataSettings kind={selectedData.kind} />
  }
  if (selectedData.kind === "group" || selectedData.kind === "team") return <GroupSettings />
  if (selectedData.kind === "org_unit") return <GroupSettings officialOrg />
  return <GenericSettings />
}

function AdvancedDetails() {
  const { text } = useUiI18n()
  return (
    <details
      className="rounded-md border border-stone-200 bg-white p-3"
      data-testid="topology-workspace-advanced"
    >
      <summary className="cursor-pointer text-xs font-semibold text-stone-700" data-testid="enterprise-inspector-advanced-edit">
        {text("고급 편집", "Advanced edit")}
      </summary>
      <div className="mt-3 grid gap-2">
        <label className="grid gap-1.5 text-xs font-semibold text-stone-500">
          <span>{text("긴 instruction", "Long instruction")}</span>
          <textarea
            rows={3}
            className="resize-none rounded-md border border-stone-200 px-2.5 py-2 text-sm text-stone-800"
            placeholder={text("필요할 때만 상세 지시를 작성합니다.", "Write detailed instructions only when needed.")}
          />
        </label>
        <div className="rounded-md border border-dashed border-stone-200 bg-stone-50 px-2.5 py-2 text-xs leading-5 text-stone-500">
          {text("Raw contract, JSON, YAML 편집은 이 고급 영역에서만 다룹니다.", "Raw contract, JSON, and YAML editing belongs only in this advanced area.")}
        </div>
      </div>
    </details>
  )
}

export function TopologyWorkspaceInspector({
  selectedData,
  templateCatalog,
  selectedNodeContract,
  executorMapping,
  runtimeResources,
  onExecutorMappingChange,
}: {
  selectedData?: EnterpriseTopologyCanvasNodeData | null
  templateCatalog?: TopologyTemplateCatalog | null
  selectedNodeContract?: NodeContract | null
  executorMapping?: TopologyWorkspaceExecutorMapping | null
  runtimeResources?: AgentTopologyProjection | null
  onExecutorMappingChange?: (nodeId: string, mapping: TopologyWorkspaceExecutorMapping) => void
}) {
  const { text } = useUiI18n()
  const effectiveExecutorMapping = executorMapping ?? readTopologyWorkspaceExecutorMappingFromNode(selectedNodeContract)

  return (
    <section
      className="rounded-lg border border-stone-200 bg-white p-4"
      data-testid="topology-workspace-inspector"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-stone-950">
          {text("선택 Inspector", "Selection Inspector")}
        </div>
        {selectedData ? (
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusToneClassName(selectedData.status)}`}>
            {selectedData.status}
          </span>
        ) : null}
      </div>
      {selectedData ? (
        <div className="mt-3 grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            <InspectorField label={text("이름", "Name")} value={selectedData.label} />
            <InspectorField label={text("종류", "Type")} value={text(TOPOLOGY_WORKSPACE_KIND_LABELS[selectedData.kind].ko, TOPOLOGY_WORKSPACE_KIND_LABELS[selectedData.kind].en)} />
            <InspectorField label={text("세부", "Detail")} value={selectedData.detail || "-"} />
            <InspectorField label="ID" value={selectedData.entityId} />
          </div>
          <TopologyWorkspaceExecutorPicker
            selectedData={selectedData}
            mapping={effectiveExecutorMapping}
            runtimeResources={runtimeResources}
            onExecutorMappingChange={onExecutorMappingChange}
          />
          <SettingsForSelection selectedData={selectedData} templateCatalog={templateCatalog} />
          <AdvancedDetails />
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-stone-200 p-4 text-sm text-stone-500">
          {text("선택 없음", "No selection")}
        </div>
      )}
    </section>
  )
}
