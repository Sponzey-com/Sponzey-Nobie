import type {
  EnterpriseMetadata,
  WorkOrderSuccessCriterion,
} from "../contracts/enterprise-topology.js"

export type WorkOrderTemplateSimulationMode = "success" | "failure"

export interface WorkOrderTemplateContextPreset {
  id: string
  labelKo: string
  labelEn: string
  input: EnterpriseMetadata
}

export interface WorkOrderTemplatePreset {
  templateId: string
  labelKo: string
  labelEn: string
  descriptionKo: string
  descriptionEn: string
  objective: string
  scopeIncluded: string[]
  scopeExcluded: string[]
  expectedOutputSchema: EnterpriseMetadata
  successCriteria: WorkOrderSuccessCriterion[]
  contextPresets: WorkOrderTemplateContextPreset[]
  defaultSimulationMode: WorkOrderTemplateSimulationMode
}

export interface WorkOrderTemplateCatalog {
  schemaVersion: 1
  templates: WorkOrderTemplatePreset[]
}

export const WORK_ORDER_TEMPLATE_CATALOG: WorkOrderTemplateCatalog = {
  schemaVersion: 1,
  templates: [
    {
      templateId: "work-order-template:customer-request-triage",
      labelKo: "고객 요청 분류",
      labelEn: "Customer request triage",
      descriptionKo: "선택한 entry node에서 고객 요청을 분류하고 다음 조치를 정리합니다.",
      descriptionEn: "Classify a customer request from the selected entry node and summarize next action.",
      objective: "Triage the selected customer request and return a concise next-action summary.",
      scopeIncluded: ["customer request", "available topology context", "declared tools"],
      scopeExcluded: ["external write action", "billing mutation"],
      expectedOutputSchema: {
        kind: "object",
        required: ["summary", "priority", "nextAction"],
      },
      successCriteria: [
        {
          criterionId: "criterion:summary",
          description: "Return a concise summary of the request.",
          required: true,
          validationKind: "manual",
        },
        {
          criterionId: "criterion:next-action",
          description: "Return one clear next action.",
          required: true,
          validationKind: "manual",
        },
      ],
      contextPresets: [
        {
          id: "context:customer-general",
          labelKo: "일반 문의",
          labelEn: "General inquiry",
          input: {
            requestKind: "general_inquiry",
            priorityHint: "normal",
          },
        },
        {
          id: "context:customer-urgent",
          labelKo: "긴급 고객 이슈",
          labelEn: "Urgent customer issue",
          input: {
            requestKind: "urgent_customer_issue",
            priorityHint: "high",
          },
        },
      ],
      defaultSimulationMode: "success",
    },
    {
      templateId: "work-order-template:failure-drill",
      labelKo: "실패 경로 점검",
      labelEn: "Failure drill",
      descriptionKo: "FailureReport와 retry/fallback 후보가 overlay에 보이는지 점검합니다.",
      descriptionEn: "Exercise FailureReport, retry, and fallback overlay behavior.",
      objective: "Run a controlled failure drill for the selected entry node.",
      scopeIncluded: ["selected node", "failure policy", "recovery policy"],
      scopeExcluded: ["real external delivery"],
      expectedOutputSchema: {
        kind: "object",
        required: ["failureSummary", "recommendedAction"],
      },
      successCriteria: [
        {
          criterionId: "criterion:failure-summary",
          description: "A failure summary is produced after exhaustion review.",
          required: true,
          validationKind: "manual",
        },
      ],
      contextPresets: [
        {
          id: "context:missing-data",
          labelKo: "필수 데이터 누락",
          labelEn: "Missing required data",
          input: {
            requestKind: "failure_drill",
            missingData: true,
          },
        },
        {
          id: "context:tool-timeout",
          labelKo: "도구 지연",
          labelEn: "Tool delay",
          input: {
            requestKind: "failure_drill",
            toolDelay: true,
          },
        },
      ],
      defaultSimulationMode: "failure",
    },
  ],
}

export function getWorkOrderTemplate(templateId: string | undefined): WorkOrderTemplatePreset {
  return WORK_ORDER_TEMPLATE_CATALOG.templates.find((template) => template.templateId === templateId)
    ?? WORK_ORDER_TEMPLATE_CATALOG.templates[0]!
}

export function getWorkOrderTemplateContext(
  template: WorkOrderTemplatePreset,
  contextPresetId: string | undefined,
): WorkOrderTemplateContextPreset {
  return template.contextPresets.find((context) => context.id === contextPresetId)
    ?? template.contextPresets[0]!
}
