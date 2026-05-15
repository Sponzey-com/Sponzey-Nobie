import type {
  EnterpriseTopology,
} from "../contracts/enterprise-topology"
import {
  EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION,
  type ExecutorRuntimeGraphSnapshotV2,
  type ExecutorTopologyV2,
  type ExecutorTopologyV2MigrationResult,
  type ExecutorTopologyV2PersistenceRepairResult,
  type ExecutorTopologyV2Timestamp,
  type ExecutorTopologyV2ValidationResult,
} from "../contracts/topology"
import {
  buildExecutorRuntimeGraphSnapshotV2 as coreBuildExecutorRuntimeGraphSnapshotV2,
  buildExecutorTopologyV2RuntimeReadModelFromEnterpriseTopology as coreBuildExecutorTopologyV2RuntimeReadModelFromEnterpriseTopology,
  enterpriseTopologyFromExecutorTopologyV2 as coreEnterpriseTopologyFromExecutorTopologyV2,
  repairExecutorTopologyV2ForPersistence as coreRepairExecutorTopologyV2ForPersistence,
  validateExecutorTopologyV2 as coreValidateExecutorTopologyV2,
} from "../../../core/src/topology/executor-topology-v2"

export { EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION }
export type {
  ExecutorEdgeV2,
  ExecutorNodeV2,
  ExecutorRuntimeGraphSnapshotV2,
  ExecutorTopologyV2,
  ExecutorTopologyV2MigrationResult,
  ExecutorTopologyV2PersistenceRepairResult,
  ExecutorTopologyV2ValidationIssue,
  ExecutorTopologyV2ValidationResult,
} from "../contracts/topology"

export function validateExecutorTopologyV2(input: unknown): ExecutorTopologyV2ValidationResult {
  return coreValidateExecutorTopologyV2(input)
}

export function repairExecutorTopologyV2ForPersistence(
  topology: ExecutorTopologyV2,
): ExecutorTopologyV2PersistenceRepairResult {
  return coreRepairExecutorTopologyV2ForPersistence(topology)
}

export function buildExecutorTopologyV2RuntimeReadModelFromEnterpriseTopology(
  topology: EnterpriseTopology,
): ExecutorTopologyV2MigrationResult {
  return coreBuildExecutorTopologyV2RuntimeReadModelFromEnterpriseTopology(topology)
}

export function enterpriseTopologyFromExecutorTopologyV2(
  topology: ExecutorTopologyV2,
  options: {
    migrationSource?: string
    sourceTopologyVersion?: number
    sourceVersionId?: string
    materializedAt?: ExecutorTopologyV2Timestamp
  } = {},
): EnterpriseTopology {
  return coreEnterpriseTopologyFromExecutorTopologyV2(topology, options)
}

export function buildExecutorRuntimeGraphSnapshotV2(
  topology: ExecutorTopologyV2,
): ExecutorRuntimeGraphSnapshotV2 {
  return coreBuildExecutorRuntimeGraphSnapshotV2(topology)
}
