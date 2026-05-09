import type { WorkOrder } from "../contracts/enterprise-topology.js"
import {
  evaluateWorkOrderAuthorityPreflight,
  type WorkOrderAuthorityDecision,
  type WorkOrderAuthorityPreflightInput,
} from "./work-order.js"

export type NodeRuntimeAuthorityDecision = WorkOrderAuthorityDecision

export interface CheckNodeRuntimeAuthorityInput {
  workOrder: WorkOrder
  authorityPreflight?: WorkOrderAuthorityPreflightInput
  authorityDecision?: WorkOrderAuthorityDecision
}

export function checkNodeRuntimeAuthority(input: CheckNodeRuntimeAuthorityInput): NodeRuntimeAuthorityDecision {
  if (input.authorityPreflight === undefined && input.authorityDecision !== undefined) {
    return cloneAuthorityDecision(input.authorityDecision)
  }

  return evaluateWorkOrderAuthorityPreflight(input.workOrder, input.authorityPreflight)
}

function cloneAuthorityDecision(decision: WorkOrderAuthorityDecision): WorkOrderAuthorityDecision {
  return {
    allowed: decision.allowed,
    status: decision.status,
    reasonCode: decision.reasonCode,
    requiredAuthorityRuleIds: [...decision.requiredAuthorityRuleIds],
    grantedAuthorityRuleIds: [...decision.grantedAuthorityRuleIds],
    deniedAuthorityRuleIds: [...decision.deniedAuthorityRuleIds],
    missingAuthorityRuleIds: [...decision.missingAuthorityRuleIds],
    approvedBy: decision.approvedBy.map((reference) => ({ ...reference })),
  }
}
