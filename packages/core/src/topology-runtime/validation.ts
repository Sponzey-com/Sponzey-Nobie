import {
  type EnterpriseMetadataValue,
  type NodeResultOutput,
  type NodeResultStatus,
  type WorkOrder,
} from "../contracts/enterprise-topology.js"
import type {
  AggregationResult,
} from "./aggregation.js"

export type AggregatedNodeValidationStatus = "valid" | "needs_revision" | "partial_success" | "failed_candidate"
export type AggregatedNodeValidationIssueCode =
  | "required_output_missing"
  | "output_schema_value_missing"
  | "output_schema_type_mismatch"
  | "output_schema_required_field_missing"
  | "success_criterion_unmet"
  | "optional_success_criterion_unmet"
  | "output_conflict_detected"
  | "source_failure_candidate"
  | "child_result_missing"
  | "quorum_not_met"

export interface AggregatedNodeValidationIssue {
  code: AggregatedNodeValidationIssueCode
  reasonCode: AggregatedNodeValidationIssueCode
  severity: "warning" | "needs_revision" | "blocked"
  message: string
  outputId?: string
  criterionId?: string
  sourceIds?: string[]
  path?: string
}

export interface AggregatedNodeValidationResult {
  status: AggregatedNodeValidationStatus
  nodeResultStatus: NodeResultStatus
  valid: boolean
  outputs: NodeResultOutput[]
  unmetSuccessCriteriaIds: string[]
  risksOrGaps: string[]
  issues: AggregatedNodeValidationIssue[]
  reasonCodes: string[]
}

export interface ValidateAggregatedNodeResultInput {
  workOrder: WorkOrder
  aggregation: AggregationResult
  allowPartialSuccess?: boolean
}

export function validateAggregatedNodeResult(
  input: ValidateAggregatedNodeResultInput,
): AggregatedNodeValidationResult {
  const outputs = input.aggregation.outputs.map((output) => cloneOutput(output))
  const outputById = new Map(outputs.map((output) => [output.outputId, output]))
  const issues: AggregatedNodeValidationIssue[] = []

  for (const aggregationIssue of input.aggregation.issues) {
    if (aggregationIssue.code === "duplicate_output_removed") continue
    issues.push({
      code: aggregationIssue.code as AggregatedNodeValidationIssueCode,
      reasonCode: aggregationIssue.reasonCode as AggregatedNodeValidationIssueCode,
      severity: aggregationIssue.severity === "info" ? "warning" : aggregationIssue.severity,
      message: aggregationIssue.message,
      ...(aggregationIssue.outputId !== undefined ? { outputId: aggregationIssue.outputId } : {}),
      sourceIds: [...aggregationIssue.sourceIds],
    })
  }

  const schemaOutputId = expectedSchemaOutputId(input.workOrder)
  const schemaOutput = outputById.get(schemaOutputId)
  if (schemaOutput === undefined || schemaOutput.status === "missing") {
    issues.push({
      code: "required_output_missing",
      reasonCode: "required_output_missing",
      severity: "blocked",
      message: "Required WorkOrder output schema result is missing.",
      outputId: schemaOutputId,
    })
  } else {
    issues.push(...validateOutputSchemaValue(input.workOrder, schemaOutput))
  }

  const unmetSuccessCriteriaIds: string[] = []
  for (const criterion of input.workOrder.successCriteria) {
    const output = outputById.get(criterion.criterionId)
    if (output?.status === "satisfied") continue
    if (criterion.required) {
      unmetSuccessCriteriaIds.push(criterion.criterionId)
      issues.push({
        code: "success_criterion_unmet",
        reasonCode: "success_criterion_unmet",
        severity: "blocked",
        message: "Required success criterion is not satisfied.",
        criterionId: criterion.criterionId,
        outputId: criterion.criterionId,
      })
    } else {
      issues.push({
        code: "optional_success_criterion_unmet",
        reasonCode: "optional_success_criterion_unmet",
        severity: "warning",
        message: "Optional success criterion is not satisfied.",
        criterionId: criterion.criterionId,
        outputId: criterion.criterionId,
      })
    }
  }

  const status = decideValidationStatus(issues, input.allowPartialSuccess === true)
  return {
    status,
    nodeResultStatus: validationStatusToNodeResultStatus(status),
    valid: status === "valid",
    outputs,
    unmetSuccessCriteriaIds,
    risksOrGaps: validationIssuesToRisks(issues),
    issues,
    reasonCodes: [
      `validation_status:${status}`,
      ...unique(issues.map((issue) => issue.reasonCode)),
    ],
  }
}

export function validationStatusToNodeResultStatus(status: AggregatedNodeValidationStatus): NodeResultStatus {
  if (status === "valid") return "completed"
  if (status === "partial_success") return "partial_success"
  if (status === "needs_revision") return "needs_revision"
  return "failed_candidate"
}

function decideValidationStatus(
  issues: AggregatedNodeValidationIssue[],
  allowPartialSuccess: boolean,
): AggregatedNodeValidationStatus {
  if (issues.some((issue) => issue.reasonCode === "success_criterion_unmet")) return "failed_candidate"
  if (issues.some((issue) => issue.severity === "blocked")) {
    return allowPartialSuccess ? "partial_success" : "failed_candidate"
  }
  if (issues.some((issue) => issue.severity === "needs_revision")) return "needs_revision"
  if (issues.some((issue) => issue.severity === "warning")) {
    return allowPartialSuccess ? "partial_success" : "valid"
  }
  return "valid"
}

function validateOutputSchemaValue(
  workOrder: WorkOrder,
  output: NodeResultOutput,
): AggregatedNodeValidationIssue[] {
  const schema = workOrder.expectedOutputSchema
  const issues: AggregatedNodeValidationIssue[] = []

  if (output.value === undefined) {
    issues.push({
      code: "output_schema_value_missing",
      reasonCode: "output_schema_value_missing",
      severity: "blocked",
      message: "Output schema result has no value.",
      outputId: output.outputId,
    })
    return issues
  }

  const expectedType = typeof schema.type === "string" ? schema.type : typeof schema.kind === "string" ? schema.kind : undefined
  if (expectedType !== undefined && !enterpriseValueMatchesSchemaType(output.value, expectedType)) {
    issues.push({
      code: "output_schema_type_mismatch",
      reasonCode: "output_schema_type_mismatch",
      severity: "blocked",
      message: `Output schema result must be ${expectedType}.`,
      outputId: output.outputId,
      path: "$.expectedOutputSchema.type",
    })
  }

  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : []
  if (required.length === 0) return issues

  if (!isRecord(output.value)) {
    issues.push({
      code: "output_schema_type_mismatch",
      reasonCode: "output_schema_type_mismatch",
      severity: "blocked",
      message: "Output schema result must be an object to validate required fields.",
      outputId: output.outputId,
      path: "$.expectedOutputSchema.required",
    })
    return issues
  }

  for (const key of required) {
    if (Object.prototype.hasOwnProperty.call(output.value, key) && output.value[key] !== undefined) continue
    issues.push({
      code: "output_schema_required_field_missing",
      reasonCode: "output_schema_required_field_missing",
      severity: "blocked",
      message: `Output schema required field ${key} is missing.`,
      outputId: output.outputId,
      path: `$.outputs.${output.outputId}.${key}`,
    })
  }

  return issues
}

function expectedSchemaOutputId(workOrder: WorkOrder): string {
  return `${workOrder.workOrderId}:expected-output-schema`
}

function validationIssuesToRisks(issues: AggregatedNodeValidationIssue[]): string[] {
  return issues.map((issue) => {
    if (issue.criterionId !== undefined) return `${issue.reasonCode}:${issue.criterionId}`
    if (issue.outputId !== undefined) return `${issue.reasonCode}:${issue.outputId}`
    if (issue.sourceIds !== undefined && issue.sourceIds.length > 0) return `${issue.reasonCode}:${issue.sourceIds.join(",")}`
    return issue.reasonCode
  })
}

function cloneOutput(output: NodeResultOutput): NodeResultOutput {
  return {
    outputId: output.outputId,
    status: output.status,
    ...(output.value !== undefined ? { value: structuredClone(output.value) } : {}),
  }
}

function enterpriseValueMatchesSchemaType(value: EnterpriseMetadataValue, expectedType: string): boolean {
  switch (expectedType) {
    case "object":
      return isRecord(value)
    case "array":
      return Array.isArray(value)
    case "string":
      return typeof value === "string"
    case "number":
      return typeof value === "number" && Number.isFinite(value)
    case "integer":
      return typeof value === "number" && Number.isInteger(value)
    case "boolean":
      return typeof value === "boolean"
    case "null":
      return value === null
    default:
      return true
  }
}

function isRecord(value: unknown): value is Record<string, EnterpriseMetadataValue> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}
