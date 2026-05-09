import type {
  EnterpriseEntityType,
  EnterpriseRelationType,
  NodeType,
} from "./enterprise-topology"

export type TopologyRelationTemplateGroup = "primary" | "more"
export type TopologyRelationLayer = "runtime" | "authority" | "analysis" | "technical"
export type TopologyRelationEasyMode = "next" | "delegate" | "approve" | "use" | "report" | "group"
export type TopologySmartConnectDirection = "source_to_target" | "target_to_source"

export interface TopologyRelationTemplatePreset {
  relationType: EnterpriseRelationType
  labelKo: string
  labelEn: string
  descriptionKo: string
  descriptionEn: string
  group: TopologyRelationTemplateGroup
  layer: TopologyRelationLayer
  runtimeCandidate: boolean
  easyLabelKo?: string
  easyLabelEn?: string
  smartConnectLabelKo?: string
  smartConnectLabelEn?: string
  allowedPairs: Array<{ from: EnterpriseEntityType; to: EnterpriseEntityType }>
}

export interface TopologyRelationTemplateCatalog {
  schemaVersion: 1
  presets: TopologyRelationTemplatePreset[]
}

export interface TopologySmartConnectEndpoint {
  entityType: EnterpriseEntityType
  nodeType?: NodeType
}

export interface TopologySmartConnectRecommendation {
  relationType: EnterpriseRelationType
  easyMode: TopologyRelationEasyMode
  direction: TopologySmartConnectDirection
  labelKo: string
  labelEn: string
  reasonKo: string
  reasonEn: string
  layer: TopologyRelationLayer
  runtimeCandidate: boolean
  priority: number
}

export interface TopologyRelationTemplateCatalogResponse {
  ok: true
  catalog: TopologyRelationTemplateCatalog
  templates: TopologyRelationTemplatePreset[]
}
