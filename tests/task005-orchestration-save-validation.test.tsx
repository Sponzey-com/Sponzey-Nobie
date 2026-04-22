import { describe, expect, it } from "vitest"
import { createOrchestrationBoardDraft } from "../packages/webui/src/lib/orchestration-board.ts"
import { buildOrchestrationBoardProjection } from "../packages/webui/src/lib/orchestration-board-projection.ts"
import { validateOrchestrationBoard } from "../packages/webui/src/lib/orchestration-board-validation.ts"
import { buildBoardViewStateFromDraft } from "../packages/webui/src/lib/orchestration-board-reducer.ts"
import { createSubAgentConfig, createTeamConfig } from "../packages/webui/src/lib/orchestration-ui.ts"

const now = Date.UTC(2026, 3, 21, 0, 0, 0)

function subAgent(agentId: string, overrides: Partial<ReturnType<typeof createSubAgentConfig>> = {}) {
  return {
    ...createSubAgentConfig({
      agentId,
      displayName: agentId,
      role: "Research worker",
      personality: "Precise and bounded.",
      specialtyTags: ["research"],
      avoidTasks: ["unguarded shell"],
      teamIds: [],
      riskCeiling: "safe",
      enabledSkillIds: ["web-search"],
      enabledMcpServerIds: ["browser"],
      enabledToolNames: ["web_search"],
      now,
    }),
    ...overrides,
  }
}

function team(teamId: string, memberAgentIds: string[] = [], overrides: Partial<ReturnType<typeof createTeamConfig>> = {}) {
  return {
    ...createTeamConfig({
      teamId,
      displayName: teamId,
      purpose: "Collect and review evidence.",
      memberAgentIds,
      roleHints: memberAgentIds.map(() => "member"),
      now,
    }),
    ...overrides,
  }
}

describe("task005 orchestration save validation", () => {
  it("collects board validation issues for gate, ids, empty teams, and high-risk cards while allowing teamless agents", () => {
    const duplicateA = subAgent("agent-dup-a1")
    const duplicateB = subAgent("agent-dup-a1", {
      capabilityPolicy: {
        ...duplicateA.capabilityPolicy,
        permissionProfile: {
          ...duplicateA.capabilityPolicy.permissionProfile,
          riskCeiling: "dangerous",
          allowShellExecution: true,
        },
      },
    })
    const invalidAgent = subAgent("bad id")
    const invalidTeam = team("bad team")
    const draft = createOrchestrationBoardDraft({
      agents: [duplicateA, duplicateB, invalidAgent],
      teams: [invalidTeam],
    })

    const result = validateOrchestrationBoard({
      draft,
      gate: {
        status: "disabled",
        canEdit: false,
        canPersist: false,
        message: "Topology editing locked",
        reasons: ["settings.control is not ready"],
      },
      language: "en",
      now,
    })

    expect(result.summary.blocking).toBe(true)
    expect(result.snapshot.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "write_gate_locked",
      "duplicate_agent_id",
      "invalid_agent_id",
      "invalid_team_id",
      "high_risk_agent",
      "empty_team",
    ]))
    expect(result.snapshot.issues.some((issue) => issue.code === "unassigned_agent")).toBe(false)
    expect(result.summary.errorCount).toBeGreaterThan(0)
    expect(result.summary.warningCount).toBeGreaterThan(0)
    expect(result.summary.infoCount).toBeGreaterThan(0)
  })

  it("maps validation issues back onto cards, lanes, and board diagnostics", () => {
    const risky = subAgent("agent-risky-a1", {
      capabilityPolicy: {
        ...subAgent("agent-risky-a1").capabilityPolicy,
        permissionProfile: {
          ...subAgent("agent-risky-a1").capabilityPolicy.permissionProfile,
          riskCeiling: "dangerous",
          allowShellExecution: true,
        },
      },
    })
    const emptyTeam = team("team-empty-t1")
    const draft = createOrchestrationBoardDraft({
      agents: [risky],
      teams: [emptyTeam],
    })
    const validation = validateOrchestrationBoard({
      draft,
      gate: {
        status: "ready",
        canEdit: true,
        canPersist: true,
        message: "",
        reasons: [],
      },
      language: "en",
      now,
    })
    const boardView = buildBoardViewStateFromDraft({
      draft,
      baseAgents: [],
      baseTeams: [],
      generatedAt: now,
    })
    const projection = buildOrchestrationBoardProjection({
      snapshot: boardView.snapshot,
      agents: boardView.agents,
      teams: boardView.teams,
      language: "en",
      validationSnapshot: validation.snapshot,
      selectedEntityId: "agent:agent-risky-a1",
    })

    expect(projection.lanes[0]?.cards[0]?.badges).toEqual(expect.arrayContaining(["1 issues"]))
    expect(projection.lanes[0]?.cards[0]?.diagnostics.some((item) => item.includes("high-risk permissions"))).toBe(true)
    expect(projection.lanes.find((lane) => lane.teamId === "team-empty-t1")?.badges).toEqual(expect.arrayContaining(["1 issues"]))
    expect(projection.diagnostics.some((item) => item.label === "Board validation")).toBe(true)
    expect(projection.selectedEntity?.details.some((detail) => detail.includes("Validation"))).toBe(true)
  })
})
