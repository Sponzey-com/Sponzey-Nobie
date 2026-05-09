import type {
  ExecutorDraft,
  ExecutorGraphWorkspace,
} from "./executor-graph"

export type ExecutorGraphRelationKind = "root_direct" | "child" | "indirect"

export interface ExecutorGraphRelationInfo {
  executorId: string
  relationKind: ExecutorGraphRelationKind
  relationLabelKo: string
  relationLabelEn: string
  relationDetailKo: string
  relationDetailEn: string
  selectableWithoutPath: boolean
  parentExecutorIds: string[]
  parentLabel?: string
  roleLabel: string
  shortId: string
  duplicateName: boolean
}

export function buildExecutorGraphRelationInfoMap(
  graph: ExecutorGraphWorkspace | null | undefined,
): Map<string, ExecutorGraphRelationInfo> {
  const result = new Map<string, ExecutorGraphRelationInfo>()
  if (!graph) return result

  const executorById = new Map(graph.executors.map((executor) => [executor.id, executor]))
  const incoming = new Map<string, string[]>()
  for (const connection of graph.connections) {
    incoming.set(connection.toExecutorId, [
      ...(incoming.get(connection.toExecutorId) ?? []),
      connection.fromExecutorId,
    ])
  }

  const nameCounts = new Map<string, number>()
  for (const executor of graph.executors) {
    const key = normalizedName(executor.name)
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1)
  }

  const depthMemo = new Map<string, number>()
  const depthFor = (executorId: string, seen = new Set<string>()): number => {
    if (depthMemo.has(executorId)) return depthMemo.get(executorId) ?? 0
    if (seen.has(executorId)) return 1
    const parents = incoming.get(executorId) ?? []
    if (parents.length === 0) {
      depthMemo.set(executorId, 0)
      return 0
    }
    const nextSeen = new Set(seen)
    nextSeen.add(executorId)
    const depth = 1 + Math.min(...parents.map((parentId) => depthFor(parentId, nextSeen)))
    depthMemo.set(executorId, depth)
    return depth
  }

  for (const executor of graph.executors) {
    const parentExecutorIds = [...(incoming.get(executor.id) ?? [])].sort((left, right) => left.localeCompare(right))
    const firstParent = parentExecutorIds[0] ? executorById.get(parentExecutorIds[0]) : undefined
    const parentLabel = firstParent ? executorNameForDisplay(firstParent) : undefined
    const depth = depthFor(executor.id)
    const duplicateName = (nameCounts.get(normalizedName(executor.name)) ?? 0) > 1
    const roleLabel = executorRoleLabel(executor)
    const shortId = shortExecutorId(executor.id)
    const relationKind: ExecutorGraphRelationKind = depth === 0
      ? "root_direct"
      : depth === 1
        ? "child"
        : "indirect"

    result.set(executor.id, {
      executorId: executor.id,
      relationKind,
      relationLabelKo: relationLabelKo(relationKind, parentLabel),
      relationLabelEn: relationLabelEn(relationKind, parentLabel),
      relationDetailKo: relationDetailKo(relationKind, parentLabel),
      relationDetailEn: relationDetailEn(relationKind, parentLabel),
      selectableWithoutPath: relationKind === "root_direct",
      parentExecutorIds,
      ...(parentLabel ? { parentLabel } : {}),
      roleLabel,
      shortId,
      duplicateName,
    })
  }

  return result
}

export function executorNameForDisplay(executor: ExecutorDraft): string {
  return executor.name.trim() || executor.id
}

export function executorRoleLabel(executor: ExecutorDraft): string {
  return (
    executor.executorProfile?.roleName?.trim() ||
    executor.advancedMapping?.nodeType ||
    runtimeModeLabel(executor.inferredRuntimeMode)
  )
}

export function shortExecutorId(executorId: string): string {
  const parts = executorId.split(":").filter(Boolean)
  return parts.at(-1) ?? executorId
}

function normalizedName(name: string): string {
  return name.trim().toLocaleLowerCase() || "(blank)"
}

function relationLabelKo(kind: ExecutorGraphRelationKind, parentLabel: string | undefined): string {
  if (kind === "root_direct") return "노비 직속"
  if (kind === "child") return `${parentLabel ?? "상위 실행자"}의 하위`
  return "간접 실행자"
}

function relationLabelEn(kind: ExecutorGraphRelationKind, parentLabel: string | undefined): string {
  if (kind === "root_direct") return "Direct child of Nobie"
  if (kind === "child") return `Child of ${parentLabel ?? "parent executor"}`
  return "Indirect executor"
}

function relationDetailKo(kind: ExecutorGraphRelationKind, parentLabel: string | undefined): string {
  if (kind === "root_direct") {
    return "채널이나 사용자 요청이 들어오면 노비가 바로 후보로 검토할 수 있는 실행자입니다."
  }
  if (kind === "child") {
    return `${parentLabel ?? "상위 실행자"}를 통해 위임 흐름에 들어갑니다. 실행 때는 연결 경로가 필요합니다.`
  }
  return "노비가 바로 고르는 후보가 아니라 연결된 위임 흐름을 거쳐 도달하는 실행자입니다."
}

function relationDetailEn(kind: ExecutorGraphRelationKind, parentLabel: string | undefined): string {
  if (kind === "root_direct") {
    return "Nobie can consider this executor directly when a channel or user request arrives."
  }
  if (kind === "child") {
    return `Execution reaches this node through ${parentLabel ?? "its parent executor"}; a connection path is required at runtime.`
  }
  return "This executor is reached through the delegation flow, not selected directly from Nobie's root decision."
}

function runtimeModeLabel(mode: ExecutorDraft["inferredRuntimeMode"]): string {
  if (mode === "tool_execution") return "도구 사용"
  if (mode === "external") return "외부 연동"
  if (mode === "approval" || mode === "human_check" || mode === "unknown") return "최종 검토"
  return "자동 처리"
}
