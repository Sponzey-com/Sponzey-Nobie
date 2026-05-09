import type { EnterpriseMetadata, WorkOrderSuccessCriterion } from "../contracts/enterprise-topology.js";
export type WorkOrderTemplateSimulationMode = "success" | "failure";
export interface WorkOrderTemplateContextPreset {
    id: string;
    labelKo: string;
    labelEn: string;
    input: EnterpriseMetadata;
}
export interface WorkOrderTemplatePreset {
    templateId: string;
    labelKo: string;
    labelEn: string;
    descriptionKo: string;
    descriptionEn: string;
    objective: string;
    scopeIncluded: string[];
    scopeExcluded: string[];
    expectedOutputSchema: EnterpriseMetadata;
    successCriteria: WorkOrderSuccessCriterion[];
    contextPresets: WorkOrderTemplateContextPreset[];
    defaultSimulationMode: WorkOrderTemplateSimulationMode;
}
export interface WorkOrderTemplateCatalog {
    schemaVersion: 1;
    templates: WorkOrderTemplatePreset[];
}
export declare const WORK_ORDER_TEMPLATE_CATALOG: WorkOrderTemplateCatalog;
export declare function getWorkOrderTemplate(templateId: string | undefined): WorkOrderTemplatePreset;
export declare function getWorkOrderTemplateContext(template: WorkOrderTemplatePreset, contextPresetId: string | undefined): WorkOrderTemplateContextPreset;
//# sourceMappingURL=work-order-templates.d.ts.map