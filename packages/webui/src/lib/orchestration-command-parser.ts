import type { OrchestrationStarterKitId } from "./orchestration-starter-kits"

export type OrchestrationCommandParseStatus = "success" | "ambiguous" | "error"

export type OrchestrationCommandParseResult =
  | {
      status: "success"
      normalizedInput: string
      starterKitId: OrchestrationStarterKitId
      count: number
      pattern: "team" | "squad" | "pair"
    }
  | {
      status: "ambiguous"
      normalizedInput: string
      reason: "role_without_group" | "group_without_role"
      suggestedStarterKitId: OrchestrationStarterKitId
      suggestedCount: number
    }
  | {
      status: "error"
      normalizedInput: string
      reason: "empty" | "unsupported" | "invalid_count"
    }

export function parseOrchestrationCreateCommand(input: string): OrchestrationCommandParseResult {
  const normalizedInput = normalizeCommand(input)
  if (!normalizedInput) {
    return { status: "error", normalizedInput, reason: "empty" }
  }

  const tokens = normalizedInput.split(" ").filter(Boolean)
  const count = resolveExplicitCount(tokens)
  if (count === 0) {
    return { status: "error", normalizedInput, reason: "invalid_count" }
  }

  const role = resolveRole(tokens)
  const group = resolveGroup(tokens)

  if (role && group) {
    return {
      status: "success",
      normalizedInput,
      starterKitId: resolveStarterKitId(role, tokens),
      count: count ?? defaultCountForGroup(group),
      pattern: group,
    }
  }

  if (role && !group) {
    return {
      status: "ambiguous",
      normalizedInput,
      reason: "role_without_group",
      suggestedStarterKitId: resolveStarterKitId(role, tokens),
      suggestedCount: defaultCountForGroup("team"),
    }
  }

  if (!role && group) {
    return {
      status: "ambiguous",
      normalizedInput,
      reason: "group_without_role",
      suggestedStarterKitId: "research_team",
      suggestedCount: count ?? defaultCountForGroup(group),
    }
  }

  return { status: "error", normalizedInput, reason: "unsupported" }
}

function normalizeCommand(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[,:;]+/g, " ")
    .replace(/\s+/g, " ")
}

function resolveRole(tokens: string[]): "research" | "review" | "operator" | null {
  if (tokens.some((token) => ["research", "researcher", "researchers", "연구", "조사"].includes(token))) return "research"
  if (tokens.some((token) => ["review", "reviewer", "reviewers", "qa", "리뷰", "검토"].includes(token))) return "review"
  if (tokens.some((token) => ["operator", "operators", "workspace", "ops", "운영", "작업"].includes(token))) return "operator"
  return null
}

function resolveGroup(tokens: string[]): "team" | "squad" | "pair" | null {
  if (tokens.some((token) => ["pair", "duo", "페어", "둘"].includes(token))) return "pair"
  if (tokens.some((token) => ["squad", "crew", "pod", "스쿼드", "크루"].includes(token))) return "squad"
  if (tokens.some((token) => ["team", "teams", "팀", "조"].includes(token))) return "team"
  return null
}

function resolveExplicitCount(tokens: string[]): number | null {
  for (const token of tokens) {
    if (/^\d+$/.test(token)) return Number(token)
    if (["one", "single", "하나", "한"].includes(token)) return 1
    if (["two", "둘"].includes(token)) return 2
    if (["three", "셋"].includes(token)) return 3
    if (["four", "넷"].includes(token)) return 4
  }
  return null
}

function defaultCountForGroup(group: "team" | "squad" | "pair"): number {
  switch (group) {
    case "pair":
      return 2
    case "squad":
      return 3
    case "team":
    default:
      return 3
  }
}

function resolveStarterKitId(
  role: "research" | "review" | "operator",
  tokens: string[],
): OrchestrationStarterKitId {
  if (role === "operator" || tokens.includes("workspace")) return "workspace_operator_pair"
  if (role === "review") return "review_squad"
  return "research_team"
}
