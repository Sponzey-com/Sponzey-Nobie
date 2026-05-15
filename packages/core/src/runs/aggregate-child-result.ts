import {
  aggregateSubSessionResultsForParent,
  buildParentAggregationRuntimeEvent,
  type ParentAggregationChildInput,
  type ParentAggregationInput,
  type ParentAggregationRuntimeEventInput,
  type ParentAggregationTrace,
} from "../agent/sub-agent-result-review.js"

export interface AggregateChildResultInput extends ParentAggregationInput {
  parentRunId: string
  childResults: ParentAggregationChildInput[]
}

export interface AggregateChildResultOutput {
  trace: ParentAggregationTrace
  event: ParentAggregationRuntimeEventInput
  finalDeliveryAllowed: boolean
  nextAction: ParentAggregationTrace["nextAction"]
  blockedSubSessionIds: string[]
  limitedSubSessionIds: string[]
  unverifiedSubSessionIds: string[]
}

export interface AggregateChildResultDependencies {
  appendParentEvent?: (parentRunId: string, label: string) => Promise<void> | void
  recordOrchestrationEvent?: (input: {
    eventKind: "parent_child_result_aggregated"
    runId: string
    subSessionId?: string
    agentId?: string
    correlationId: string
    dedupeKey: string
    source: string
    summary: string
    payload: Record<string, unknown>
  }) => void
}

export class AggregateChildResult {
  constructor(private readonly dependencies: AggregateChildResultDependencies = {}) {}

  async execute(input: AggregateChildResultInput): Promise<AggregateChildResultOutput> {
    for (const child of input.childResults) {
      if (child.resultReport) {
        await this.dependencies.appendParentEvent?.(
          input.parentRunId,
          `child_result_received:${child.subSessionId}:${child.resultReport.resultReportId}:${child.resultReport.status}`,
        )
      }
    }
    await this.dependencies.appendParentEvent?.(
      input.parentRunId,
      `parent_child_result_aggregation_started:${input.childResults.map((child) => child.subSessionId).join(",") || "none"}`,
    )

    const trace = aggregateSubSessionResultsForParent(input)
    const event = buildParentAggregationRuntimeEvent(trace)
    const primaryChild = input.childResults[0]

    await this.dependencies.appendParentEvent?.(
      input.parentRunId,
      `parent_child_result_aggregated:${primaryChild?.subSessionId ?? "none"}:${trace.nextAction}`,
    )
    await this.dependencies.appendParentEvent?.(
      input.parentRunId,
      trace.finalDeliveryAllowed
        ? `parent_child_result_ready_for_finalization:${primaryChild?.subSessionId ?? "none"}`
        : `parent_child_result_recovery_required:${primaryChild?.subSessionId ?? "none"}:${trace.nextAction}`,
    )

    this.dependencies.recordOrchestrationEvent?.({
      eventKind: "parent_child_result_aggregated",
      runId: input.parentRunId,
      ...(primaryChild?.subSessionId ? { subSessionId: primaryChild.subSessionId } : {}),
      ...(primaryChild?.resultReport?.source?.entityId
        ? { agentId: primaryChild.resultReport.source.entityId }
        : {}),
      correlationId: input.parentRunId,
      dedupeKey: [
        "orchestration:parent-child-result-aggregated",
        input.parentRunId,
        primaryChild?.subSessionId ?? "none",
        primaryChild?.resultReport?.resultReportId ?? "none",
      ].join(":"),
      source: "aggregate-child-result",
      summary: event.summary,
      payload: { ...event.payload },
    })

    return {
      trace,
      event,
      finalDeliveryAllowed: trace.finalDeliveryAllowed,
      nextAction: trace.nextAction,
      blockedSubSessionIds: trace.blockedSubSessionIds,
      limitedSubSessionIds: trace.limitedSubSessionIds,
      unverifiedSubSessionIds: trace.unverifiedSubSessionIds,
    }
  }
}
