import { createHash } from "node:crypto"
import {
  ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
  type AuthorityScope,
  type EnterpriseTimestamp,
  type NodeContract,
  type NodeRuntimeProfileSnapshot,
  type PermissionScope,
  type WorkOrder,
} from "../contracts/enterprise-topology.js"
import type { CompiledTopologySnapshot } from "../topology/compiler.js"
import {
  deriveEffectiveWorkOrderPermissionScope,
  type EffectiveWorkOrderPermissionScope,
} from "./work-order.js"

export interface CreateNodeRuntimeProfileSnapshotInput {
  workOrder: WorkOrder
  nodeContractSnapshot: NodeContract
  compiledTopologySnapshot: CompiledTopologySnapshot
  effectivePermissionScope?: EffectiveWorkOrderPermissionScope
  profileSnapshotId?: string
  createdAt?: EnterpriseTimestamp
}

export function createNodeRuntimeProfileSnapshot(
  input: CreateNodeRuntimeProfileSnapshotInput,
): NodeRuntimeProfileSnapshot {
  const effectivePermissionScope = input.effectivePermissionScope ?? deriveEffectiveWorkOrderPermissionScope({
    workOrder: input.workOrder,
    nodeContractSnapshot: input.nodeContractSnapshot,
    compiledTopologySnapshot: input.compiledTopologySnapshot,
  })
  const createdAt = input.createdAt ?? Date.now()
  const profileSnapshotId = input.profileSnapshotId ?? buildNodeRuntimeProfileSnapshotId({
    workOrderId: input.workOrder.workOrderId,
    nodeId: input.nodeContractSnapshot.id,
    compiledTopologySnapshotId: input.compiledTopologySnapshot.compiledTopologySnapshotId,
    createdAt,
  })

  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    profileSnapshotId,
    topologyId: input.compiledTopologySnapshot.topologyId,
    compiledTopologySnapshotId: input.compiledTopologySnapshot.compiledTopologySnapshotId,
    nodeId: input.nodeContractSnapshot.id,
    workOrderId: input.workOrder.workOrderId,
    permissionScope: permissionScopeFromEffective(effectivePermissionScope),
    authorityScope: cloneAuthorityScope(input.workOrder.authorityScope),
    allowedToolIds: [...effectivePermissionScope.allowedToolIds],
    allowedSystemIds: [...effectivePermissionScope.allowedSystemIds],
    delegationPath: [...input.workOrder.delegationPath],
    createdAt,
    source: {
      nodeContractId: input.nodeContractSnapshot.id,
      workOrderId: input.workOrder.workOrderId,
      compiledTopologySnapshotId: input.compiledTopologySnapshot.compiledTopologySnapshotId,
    },
  }
}

export function buildNodeRuntimeProfileSnapshotId(input: {
  workOrderId: string
  nodeId: string
  compiledTopologySnapshotId: string
  createdAt: EnterpriseTimestamp
}): string {
  const hash = createHash("sha256")
    .update(`${input.workOrderId}|${input.nodeId}|${input.compiledTopologySnapshotId}|${String(input.createdAt)}`)
    .digest("hex")
    .slice(0, 16)
  return `profile-snapshot:${hash}`
}

function permissionScopeFromEffective(effective: EffectiveWorkOrderPermissionScope): PermissionScope {
  return {
    allowedToolIds: [...effective.allowedToolIds],
    allowedSystemIds: [...effective.allowedSystemIds],
    dataDomainIds: [...effective.dataDomainIds],
    ...(effective.riskLevel !== undefined ? { riskLevel: effective.riskLevel } : {}),
  }
}

function cloneAuthorityScope(scope: AuthorityScope): AuthorityScope {
  return {
    requiredAuthorityRuleIds: [...scope.requiredAuthorityRuleIds],
    approvalRequired: scope.approvalRequired,
    ...(scope.approvedBy !== undefined ? { approvedBy: scope.approvedBy.map((reference) => ({ ...reference })) } : {}),
  }
}
