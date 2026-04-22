import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import { OrchestrationSaveResultToast } from "../packages/webui/src/components/orchestration/OrchestrationSaveResultToast.tsx"
import { createOrchestrationBoardDraft } from "../packages/webui/src/lib/orchestration-board.ts"
import { createBoardAgentDraft, createBoardTeamDraft } from "../packages/webui/src/lib/orchestration-board-editing.ts"
import { buildOrchestrationSavePlan, mergeBoardDraftWithRemoteState, summarizeRemainingInstructionKeys } from "../packages/webui/src/lib/orchestration-save-plan.ts"
import { createTeamConfig } from "../packages/webui/src/lib/orchestration-ui.ts"

const now = Date.UTC(2026, 3, 21, 0, 0, 0)

describe("task005 orchestration partial persist", () => {
  it("builds a stable save order and keeps unstored entries in the draft after reload", () => {
    const initial = createOrchestrationBoardDraft({ agents: [], teams: [] })
    const withTeam = createBoardTeamDraft({
      draft: initial,
      displayName: "Draft team",
      randomSuffix: () => "t9k3",
    })
    const withAgent = createBoardAgentDraft({
      draft: withTeam,
      displayName: "Draft agent",
      randomSuffix: () => "a1b2",
    })
    const plan = buildOrchestrationSavePlan({ draft: withAgent })

    expect(plan.instructions.map((instruction) => instruction.key)).toEqual([
      "team:team-draft-team-t9k3",
      "agent:agent-draft-agent-a1b2",
    ])

    const remaining = summarizeRemainingInstructionKeys({
      plan,
      firstUnstoredKey: "agent:agent-draft-agent-a1b2",
    })
    const persistedTeam = createTeamConfig({
      teamId: "team-draft-team-t9k3",
      displayName: "Draft team",
      purpose: "Persisted team",
      memberAgentIds: [],
      roleHints: [],
      now,
    })
    const merged = mergeBoardDraftWithRemoteState({
      currentDraft: withAgent,
      remoteSnapshot: {
        generatedAt: now,
        agents: [],
        teams: [{
          teamId: persistedTeam.teamId,
          displayName: persistedTeam.displayName,
          nickname: persistedTeam.nickname,
          status: persistedTeam.status,
          purpose: persistedTeam.purpose,
          roleHints: persistedTeam.roleHints,
          memberAgentIds: persistedTeam.memberAgentIds,
          activeMemberAgentIds: [],
          unresolvedMemberAgentIds: [],
          source: "db",
          config: persistedTeam,
        }],
        membershipEdges: [],
        diagnostics: [],
      },
      remoteAgents: [],
      remoteTeams: [{
        teamId: persistedTeam.teamId,
        displayName: persistedTeam.displayName,
        nickname: persistedTeam.nickname,
        status: persistedTeam.status,
        purpose: persistedTeam.purpose,
        roleHints: persistedTeam.roleHints,
        memberAgentIds: persistedTeam.memberAgentIds,
        activeMemberAgentIds: [],
        unresolvedMemberAgentIds: [],
        source: "db",
        config: persistedTeam,
      }],
      remainingInstructionKeys: remaining,
      selectedNodeId: "agent:agent-draft-agent-a1b2",
    })

    expect(remaining).toEqual(["agent:agent-draft-agent-a1b2"])
    expect(merged.teams.find((team) => team.teamId === "team-draft-team-t9k3")?.persisted).toBe(true)
    expect(merged.agents.find((agent) => agent.agentId === "agent-draft-agent-a1b2")?.persisted).toBe(false)
    expect(merged.selectedNodeId).toBe("agent:agent-draft-agent-a1b2")
    expect(merged.dirty).toBe(true)
  })

  it("renders toast states that distinguish validation, partial writes, and retry context", () => {
    const html = renderToStaticMarkup(createElement(OrchestrationSaveResultToast, {
      language: "en",
      result: {
        status: "partial",
        summary: "Only part of the board was stored.",
        effects: ["validated team:team-draft-team-t9k3", "stored team:team-draft-team-t9k3"],
        entities: [
          {
            key: "team:team-draft-team-t9k3",
            targetType: "team",
            targetId: "team-draft-team-t9k3",
            phase: "preflight",
            status: "succeeded",
            message: "validated",
          },
          {
            key: "agent:agent-draft-agent-a1b2",
            targetType: "agent",
            targetId: "agent-draft-agent-a1b2",
            phase: "persist",
            status: "failed",
            message: "409 Conflict",
          },
        ],
      },
    }))

    expect(html).toContain('data-orchestration-save-toast="partial"')
    expect(html).toContain("Only part of the board was stored.")
    expect(html).toContain("1 success / 1 failed")
    expect(html).toContain("Show detailed status")
    expect(html).toContain("409 Conflict")
  })
})
