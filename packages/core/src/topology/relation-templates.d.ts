import type { EnterpriseEntityType, EnterpriseRelationType, NodeType } from "../contracts/enterprise-topology.js";
export type TopologyRelationTemplateGroup = "primary" | "more";
export type TopologyRelationLayer = "runtime" | "authority" | "analysis" | "technical";
export type TopologyRelationEasyMode = "next" | "delegate" | "approve" | "use" | "report" | "group";
export interface TopologyRelationTemplatePreset {
    relationType: EnterpriseRelationType;
    labelKo: string;
    labelEn: string;
    descriptionKo: string;
    descriptionEn: string;
    group: TopologyRelationTemplateGroup;
    layer: TopologyRelationLayer;
    runtimeCandidate: boolean;
    easyLabelKo?: string;
    easyLabelEn?: string;
    smartConnectLabelKo?: string;
    smartConnectLabelEn?: string;
    allowedPairs: Array<{
        from: EnterpriseEntityType;
        to: EnterpriseEntityType;
    }>;
}
export interface TopologyRelationTemplateCatalog {
    schemaVersion: 1;
    presets: TopologyRelationTemplatePreset[];
}
export type TopologySmartConnectDirection = "source_to_target" | "target_to_source";
export interface TopologySmartConnectEndpoint {
    entityType: EnterpriseEntityType;
    nodeType?: NodeType;
}
export interface TopologySmartConnectRecommendation {
    relationType: EnterpriseRelationType;
    easyMode: TopologyRelationEasyMode;
    direction: TopologySmartConnectDirection;
    labelKo: string;
    labelEn: string;
    reasonKo: string;
    reasonEn: string;
    layer: TopologyRelationLayer;
    runtimeCandidate: boolean;
    priority: number;
}
export interface TopologySmartConnectIssue {
    reasonCode: "no_valid_relation";
    messageKo: string;
    messageEn: string;
    sourceEntityType: EnterpriseEntityType;
    targetEntityType: EnterpriseEntityType;
}
export type TopologySmartConnectPlan = {
    ok: true;
    recommendation: TopologySmartConnectRecommendation;
    recommendations: TopologySmartConnectRecommendation[];
} | {
    ok: false;
    issue: TopologySmartConnectIssue;
    recommendations: [];
};
export declare const TOPOLOGY_RELATION_TEMPLATE_CATALOG: TopologyRelationTemplateCatalog;
export declare function recommendTopologySmartConnectRelations(input: {
    source: TopologySmartConnectEndpoint;
    target: TopologySmartConnectEndpoint;
    catalog?: TopologyRelationTemplateCatalog;
}): TopologySmartConnectRecommendation[];
export declare function recommendTopologySmartConnectRelation(input: {
    source: TopologySmartConnectEndpoint;
    target: TopologySmartConnectEndpoint;
    catalog?: TopologyRelationTemplateCatalog;
}): TopologySmartConnectRecommendation | undefined;
export declare function planTopologySmartConnect(input: {
    source: TopologySmartConnectEndpoint;
    target: TopologySmartConnectEndpoint;
    catalog?: TopologyRelationTemplateCatalog;
}): TopologySmartConnectPlan;
//# sourceMappingURL=relation-templates.d.ts.map