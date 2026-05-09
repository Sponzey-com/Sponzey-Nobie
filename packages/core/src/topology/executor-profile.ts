import type {
  EnterpriseMetadataValue,
  NodeContract,
} from "../contracts/enterprise-topology.js"

export const EXECUTOR_PROFILE_SCHEMA_VERSION = 1 as const
export const EXECUTOR_PROFILE_METADATA_KEY = "executorProfile" as const

export interface ExecutorProfile {
  schemaVersion: typeof EXECUTOR_PROFILE_SCHEMA_VERSION
  executorId: string
  displayName: string
  roleName: string
  definition: string
  does: string[]
  delegationScope: string[]
  expectedOutputs: string[]
  handoffStyle: string
  declineCriteria: string[]
  riskBoundary: string[]
}

export function normalizeExecutorProfile(
  value: unknown,
  fallback: {
    executorId: string
    displayName: string
    roleName?: string | undefined
    definition?: string | undefined
    does?: string[] | undefined
    delegationScope?: string[] | undefined
    expectedOutputs?: string[] | undefined
    handoffStyle?: string | undefined
    declineCriteria?: string[] | undefined
    riskBoundary?: string[] | undefined
  },
): ExecutorProfile {
  const record = metadataRecord(value)
  const roleName = metadataString(record?.roleName) ?? metadataString(fallback.roleName) ?? "executor"
  const definition =
    metadataString(record?.definition) ??
    metadataString(fallback.definition) ??
    `${fallback.displayName} executor`
  const does = firstStringArray(record?.does, fallback.does, [definition])
  const delegationScope = firstStringArray(record?.delegationScope, fallback.delegationScope, does)
  const expectedOutputs = firstStringArray(
    record?.expectedOutputs,
    fallback.expectedOutputs,
    ["처리 결과"],
  )
  const handoffStyle =
    metadataString(record?.handoffStyle) ??
    metadataString(fallback.handoffStyle) ??
    "structured_handoff"
  const declineCriteria = firstStringArray(record?.declineCriteria, fallback.declineCriteria)
  const riskBoundary = firstStringArray(record?.riskBoundary, fallback.riskBoundary)
  return {
    schemaVersion: EXECUTOR_PROFILE_SCHEMA_VERSION,
    executorId: metadataString(record?.executorId) ?? fallback.executorId,
    displayName: metadataString(record?.displayName) ?? fallback.displayName,
    roleName,
    definition,
    does,
    delegationScope,
    expectedOutputs,
    handoffStyle,
    declineCriteria,
    riskBoundary,
  }
}

export function buildExecutorProfileFromNode(
  node: NodeContract,
  overrides: { executorId?: string; displayName?: string } = {},
): ExecutorProfile {
  const displayName = overrides.displayName ?? node.displayName?.trim() ?? node.name.trim() ?? node.id
  return normalizeExecutorProfile(executorProfileMetadataValue(node), {
    executorId: overrides.executorId ?? node.id,
    displayName,
    roleName:
      metadataString(node.metadata?.roleName) ??
      metadataString(node.metadata?.role) ??
      metadataString(node.template?.metadata?.roleName) ??
      metadataString(node.template?.metadata?.role) ??
      node.nodeType,
    definition: node.description?.trim() || node.instruction?.trim() || displayName,
    does: metadataStringArray(node.template?.metadata?.does),
    delegationScope: sortedUniqueStrings([
      ...node.tags,
      ...metadataStringArray(node.metadata?.capabilityHints),
      ...metadataStringArray(node.metadata?.inferredCapabilities),
      ...metadataStringArray(node.template?.metadata?.capabilityHints),
      ...metadataStringArray(node.template?.metadata?.inferredCapabilities),
    ]),
    expectedOutputs: [
      ...metadataStringArray(node.template?.metadata?.expectedOutputs),
      ...metadataStringArray(node.template?.metadata?.outputs),
    ],
    handoffStyle: metadataString(node.template?.metadata?.handoffStyle),
    declineCriteria: [
      ...metadataStringArray(node.metadata?.declineCriteria),
      ...metadataStringArray(node.template?.metadata?.declineCriteria),
    ],
    riskBoundary: [
      ...metadataStringArray(node.metadata?.riskBoundary),
      ...metadataStringArray(node.template?.metadata?.riskBoundary),
    ],
  })
}

function executorGraphMetadataRecord(node: NodeContract): Record<string, unknown> | undefined {
  return metadataRecord(node.metadata?.executorGraph)
}

function executorProfileMetadataValue(node: NodeContract): EnterpriseMetadataValue | undefined {
  const graphMetadata = executorGraphMetadataRecord(node)
  return (
    node.metadata?.[EXECUTOR_PROFILE_METADATA_KEY] ??
    node.template?.metadata?.[EXECUTOR_PROFILE_METADATA_KEY] ??
    (graphMetadata?.[EXECUTOR_PROFILE_METADATA_KEY] as EnterpriseMetadataValue | undefined)
  )
}

function firstStringArray(...values: unknown[]): string[] {
  for (const value of values) {
    const strings = metadataStringArray(value)
    if (strings.length > 0) return sortedUniqueStrings(strings)
  }
  return []
}

function metadataString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function metadataStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => (typeof entry === "string" && entry.trim() ? [entry.trim()] : []))
    : []
}

function metadataRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function sortedUniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))]
    .sort((left, right) => left.localeCompare(right))
}
