import type {
  NodeResultOutput,
  NodeResultReport,
  WorkOrder,
} from "../contracts/enterprise-topology.js"
import type {
  ChildDispatchSummary,
} from "./child-dispatcher.js"
import type {
  NodeToolExecutionSummary,
} from "./tool-dispatcher.js"

export type AggregationStrategy =
  | "merge_and_validate"
  | "parent_decides"
  | "require_all_child_results"
  | "best_effort_with_warnings"
  | "quorum"

export type AggregatedResultSourceKind = "self" | "child" | "tool"
export type AggregationIssueCode =
  | "duplicate_output_removed"
  | "output_conflict_detected"
  | "child_result_missing"
  | "source_failure_candidate"
  | "quorum_not_met"

export interface AggregatedResultSource {
  sourceKind: AggregatedResultSourceKind
  sourceId: string
  status: "completed" | "partial_success" | "failed_candidate" | "permission_limited" | "needs_revision" | "failed"
  outputCount: number
  failureCandidate: boolean
  risksOrGaps: string[]
}

export interface AggregatedResultItem {
  sourceKind: AggregatedResultSourceKind
  sourceId: string
  output: NodeResultOutput
  fingerprint: string
}

export interface AggregationIssue {
  code: AggregationIssueCode
  reasonCode: AggregationIssueCode
  severity: "info" | "warning" | "needs_revision" | "blocked"
  message: string
  outputId?: string
  sourceIds: string[]
}

export interface AggregationResult {
  strategy: AggregationStrategy
  workOrderId: string
  outputs: NodeResultOutput[]
  items: AggregatedResultItem[]
  sources: AggregatedResultSource[]
  issues: AggregationIssue[]
  conflicts: AggregationIssue[]
  duplicates: AggregationIssue[]
  missingChildNodeIds: string[]
  reasonCodes: string[]
}

export interface AggregateNodeRuntimeResultsInput {
  workOrder: WorkOrder
  strategy?: AggregationStrategy
  selfOutputs?: NodeResultOutput[]
  selfStatus?: AggregatedResultSource["status"]
  selfRisksOrGaps?: string[]
  childReports?: NodeResultReport[]
  childDelegation?: ChildDispatchSummary
  toolExecution?: NodeToolExecutionSummary
  expectedChildNodeIds?: string[]
  requireAllChildResults?: boolean
  quorum?: {
    requiredSatisfiedSourceCount: number
  }
}

export function aggregateNodeRuntimeResults(input: AggregateNodeRuntimeResultsInput): AggregationResult {
  const strategy = input.strategy ?? "merge_and_validate"
  const rawItems: AggregatedResultItem[] = []
  const sources: AggregatedResultSource[] = []
  const issues: AggregationIssue[] = []

  if (input.selfOutputs !== undefined) {
    const sourceId = input.workOrder.to.id
    sources.push({
      sourceKind: "self",
      sourceId,
      status: input.selfStatus ?? "completed",
      outputCount: input.selfOutputs.length,
      failureCandidate: isFailureCandidateStatus(input.selfStatus ?? "completed"),
      risksOrGaps: [...(input.selfRisksOrGaps ?? [])],
    })
    rawItems.push(...input.selfOutputs.map((output) => buildItem("self", sourceId, output)))
  }

  const childReports = [
    ...(input.childReports ?? []),
    ...(input.childDelegation?.results.flatMap((result) => result.nodeResultReport ? [result.nodeResultReport] : []) ?? []),
  ]
  for (const report of childReports) {
    sources.push({
      sourceKind: "child",
      sourceId: report.nodeId,
      status: report.status,
      outputCount: report.outputs.length,
      failureCandidate: isFailureCandidateStatus(report.status),
      risksOrGaps: [...report.risksOrGaps],
    })
    rawItems.push(...report.outputs.map((output) => buildItem("child", report.nodeId, output)))
  }

  for (const toolResult of input.toolExecution?.results ?? []) {
    const output: NodeResultOutput = {
      outputId: `tool:${toolResult.toolId}`,
      status: toolResult.status === "succeeded" ? "satisfied" : "missing",
      ...(toolResult.output !== undefined ? { value: toolResult.output } : {}),
    }
    sources.push({
      sourceKind: "tool",
      sourceId: toolResult.toolId,
      status: toolResult.failureCandidate ? "failed_candidate" : "completed",
      outputCount: 1,
      failureCandidate: toolResult.failureCandidate,
      risksOrGaps: [
        ...(toolResult.error !== undefined ? [toolResult.error] : []),
        ...(toolResult.failureCandidate ? [toolResult.reasonCode] : []),
      ],
    })
    rawItems.push(buildItem("tool", toolResult.toolId, output))
  }

  for (const source of sources) {
    if (!source.failureCandidate) continue
    issues.push({
      code: "source_failure_candidate",
      reasonCode: "source_failure_candidate",
      severity: "warning",
      message: "A source result is a failure candidate and must be reviewed before final failure.",
      sourceIds: [source.sourceId],
    })
  }

  const expectedChildNodeIds = input.expectedChildNodeIds ?? []
  const actualChildNodeIds = new Set(sources.filter((source) => source.sourceKind === "child").map((source) => source.sourceId))
  const missingChildNodeIds = expectedChildNodeIds.filter((nodeId) => !actualChildNodeIds.has(nodeId))
  if (missingChildNodeIds.length > 0 && (input.requireAllChildResults === true || strategy === "require_all_child_results")) {
    issues.push({
      code: "child_result_missing",
      reasonCode: "child_result_missing",
      severity: "blocked",
      message: "A required child result is missing.",
      sourceIds: missingChildNodeIds,
    })
  }

  if (strategy === "quorum" && input.quorum !== undefined) {
    const satisfiedSourceCount = new Set(
      rawItems.filter((item) => item.output.status === "satisfied").map((item) => item.sourceId),
    ).size
    if (satisfiedSourceCount < input.quorum.requiredSatisfiedSourceCount) {
      issues.push({
        code: "quorum_not_met",
        reasonCode: "quorum_not_met",
        severity: "blocked",
        message: "Aggregation quorum was not met.",
        sourceIds: sources.map((source) => source.sourceId),
      })
    }
  }

  const { outputs, duplicates, conflicts } = mergeOutputs(rawItems, strategy)
  issues.push(...duplicates, ...conflicts)

  return {
    strategy,
    workOrderId: input.workOrder.workOrderId,
    outputs,
    items: rawItems,
    sources,
    issues,
    conflicts,
    duplicates,
    missingChildNodeIds,
    reasonCodes: [
      `aggregation_strategy:${strategy}`,
      ...(duplicates.length > 0 ? ["duplicate_output_removed"] : []),
      ...(conflicts.length > 0 ? ["output_conflict_detected"] : []),
      ...(missingChildNodeIds.length > 0 ? ["child_result_missing"] : []),
    ],
  }
}

function mergeOutputs(
  items: AggregatedResultItem[],
  strategy: AggregationStrategy,
): { outputs: NodeResultOutput[]; duplicates: AggregationIssue[]; conflicts: AggregationIssue[] } {
  const byOutputId = new Map<string, AggregatedResultItem[]>()
  for (const item of items) {
    byOutputId.set(item.output.outputId, [...(byOutputId.get(item.output.outputId) ?? []), item])
  }

  const outputs: NodeResultOutput[] = []
  const duplicates: AggregationIssue[] = []
  const conflicts: AggregationIssue[] = []

  for (const [outputId, groupedItems] of byOutputId.entries()) {
    const seenFingerprints = new Set<string>()
    const uniqueItems: AggregatedResultItem[] = []
    for (const item of groupedItems) {
      if (seenFingerprints.has(item.fingerprint)) {
        duplicates.push({
          code: "duplicate_output_removed",
          reasonCode: "duplicate_output_removed",
          severity: "info",
          message: "Duplicate output was removed during aggregation.",
          outputId,
          sourceIds: [item.sourceId],
        })
        continue
      }
      seenFingerprints.add(item.fingerprint)
      uniqueItems.push(item)
    }

    if (uniqueItems.length > 1) {
      conflicts.push({
        code: "output_conflict_detected",
        reasonCode: "output_conflict_detected",
        severity: strategy === "parent_decides" ? "warning" : "needs_revision",
        message: "Multiple sources produced conflicting output for the same output id.",
        outputId,
        sourceIds: uniqueItems.map((item) => item.sourceId),
      })
    }

    const selected = selectOutputForMerge(uniqueItems)
    if (selected !== undefined) outputs.push(cloneOutput(selected.output))
  }

  return { outputs, duplicates, conflicts }
}

function selectOutputForMerge(items: AggregatedResultItem[]): AggregatedResultItem | undefined {
  return [...items].sort((left, right) => sourcePriority(left.sourceKind) - sourcePriority(right.sourceKind))[0]
}

function sourcePriority(kind: AggregatedResultSourceKind): number {
  if (kind === "self") return 0
  if (kind === "child") return 1
  return 2
}

function buildItem(
  sourceKind: AggregatedResultSourceKind,
  sourceId: string,
  output: NodeResultOutput,
): AggregatedResultItem {
  return {
    sourceKind,
    sourceId,
    output: cloneOutput(output),
    fingerprint: stableStringify({
      outputId: output.outputId,
      status: output.status,
      value: output.value ?? null,
    }),
  }
}

function cloneOutput(output: NodeResultOutput): NodeResultOutput {
  return {
    outputId: output.outputId,
    status: output.status,
    ...(output.value !== undefined ? { value: structuredClone(output.value) } : {}),
  }
}

function isFailureCandidateStatus(status: AggregatedResultSource["status"]): boolean {
  return status === "failed_candidate" || status === "permission_limited" || status === "failed"
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value))
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortJsonValue(nested)]),
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
