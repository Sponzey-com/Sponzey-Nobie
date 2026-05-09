import type { NodeContract, WorkOrder } from "../contracts/enterprise-topology.js"
import type { CompiledTopologySnapshot } from "../topology/compiler.js"
import {
  deriveEffectiveWorkOrderPermissionScope,
  type EffectiveWorkOrderPermissionScope,
} from "./work-order.js"

export type NodeRuntimePermissionDecisionStatus = "allowed" | "denied"

export interface NodeRuntimePermissionDecision {
  allowed: boolean
  status: NodeRuntimePermissionDecisionStatus
  reasonCode: "permission_scope_allowed" | "permission_scope_denied"
  missingToolIds: string[]
  missingSystemIds: string[]
  missingDataDomainIds: string[]
  effectivePermissionScope: EffectiveWorkOrderPermissionScope
  reasonCodes: string[]
}

export interface CheckNodeRuntimePermissionInput {
  workOrder: WorkOrder
  nodeContractSnapshot: NodeContract
  compiledTopologySnapshot: CompiledTopologySnapshot
}

export function checkNodeRuntimePermission(
  input: CheckNodeRuntimePermissionInput,
): NodeRuntimePermissionDecision {
  const effectivePermissionScope = deriveEffectiveWorkOrderPermissionScope(input)
  const missingToolIds = [...effectivePermissionScope.removedToolIds]
  const missingSystemIds = [...effectivePermissionScope.removedSystemIds]
  const missingDataDomainIds = [...effectivePermissionScope.removedDataDomainIds]
  const denied = missingToolIds.length > 0 || missingSystemIds.length > 0 || missingDataDomainIds.length > 0

  return {
    allowed: !denied,
    status: denied ? "denied" : "allowed",
    reasonCode: denied ? "permission_scope_denied" : "permission_scope_allowed",
    missingToolIds,
    missingSystemIds,
    missingDataDomainIds,
    effectivePermissionScope,
    reasonCodes: [
      ...effectivePermissionScope.reasonCodes,
      denied ? "node_runtime_permission_denied" : "node_runtime_permission_allowed",
    ],
  }
}
