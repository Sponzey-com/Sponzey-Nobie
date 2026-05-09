import type { NodeType } from "./enterprise-topology"

export type TopologyBeginnerPaletteKind =
  | "task"
  | "decision"
  | "approval"
  | "tool"
  | "data"
  | "group"

export type TopologyTemplateEntityKind =
  | TopologyBeginnerPaletteKind
  | "work_node"
  | "team"
  | "org_unit"
  | "position"
  | "person"
  | "process"
  | "system"
  | "tool"
  | "authority"
  | "responsibility"

export interface TopologyNodeTemplatePreset {
  id: string
  labelKo: string
  labelEn: string
  descriptionKo: string
  descriptionEn: string
  nodeType: NodeType
  defaultNameKo: string
  defaultNameEn: string
  expertiseChips: string[]
  successCriteria: string[]
  fixedRoleCatalog: false
}

export interface TopologyEntityTemplatePreset {
  kind: TopologyTemplateEntityKind
  labelKo: string
  labelEn: string
  defaultNameKo: string
  defaultNameEn: string
  group: "core" | "advanced"
}

export interface TopologyTemplateCatalog {
  schemaVersion: 1
  nodePresets: TopologyNodeTemplatePreset[]
  entityPresets: TopologyEntityTemplatePreset[]
  workspaceStarterTemplates: TopologyWorkspaceStarterTemplatePreset[]
  flowTemplates: TopologyFlowTemplatePreset[]
  expertiseChips: string[]
  successCriteriaPresets: string[]
}

export type TopologyFlowTemplateId =
  | "customer-request-flow"
  | "approval-request-flow"
  | "research-review-flow"
  | "tool-assisted-flow"
  | "escalation-flow"
  | "blank-graph"

export interface TopologyWorkspaceStarterTemplatePreset {
  id: TopologyFlowTemplateId
  labelKo: string
  labelEn: string
  descriptionKo: string
  descriptionEn: string
  noTypingRequired: true
  recommendedLayer: "build"
}

export interface TopologyFlowTemplatePreset extends TopologyWorkspaceStarterTemplatePreset {
  nodeCount: number
  connectionCount: number
  defaultWorkOrderTemplateId: string
  defaultContextPresetId: string
  defaultSimulationMode: "success" | "failure"
}

export interface TopologyTemplateCatalogResponse {
  ok: true
  catalog: TopologyTemplateCatalog
  templates: TopologyNodeTemplatePreset[]
}
