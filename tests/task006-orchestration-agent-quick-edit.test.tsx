import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import { OrchestrationQuickEditSheet } from "../packages/webui/src/components/orchestration/OrchestrationQuickEditSheet.tsx"
import type { OrchestrationAgentRegistryEntry } from "../packages/webui/src/contracts/orchestration-api.ts"
import { createOrchestrationBoardDraft } from "../packages/webui/src/lib/orchestration-board.ts"
import { createBoardAgentDraft, createBoardTeamDraft, patchBoardAgentDraft, patchBoardTeamDraft } from "../packages/webui/src/lib/orchestration-board-editing.ts"
import { AGENT_CAPABILITY_PRESETS, AGENT_ROLE_PRESETS } from "../packages/webui/src/lib/orchestration-presets.ts"

function buildRuntimeAgent(config: ReturnType<typeof createBoardAgentDraft>["agents"][number]["config"]): OrchestrationAgentRegistryEntry {
  return {
    agentId: config.agentId,
    displayName: config.displayName,
    nickname: config.nickname,
    status: config.status,
    role: config.role,
    specialtyTags: config.specialtyTags,
    avoidTasks: config.avoidTasks,
    teamIds: config.teamIds,
    delegationEnabled: config.delegation.enabled,
    retryBudget: config.delegation.retryBudget,
    source: "db",
    config,
    permissionProfile: config.capabilityPolicy.permissionProfile,
    capabilityPolicy: config.capabilityPolicy,
    skillMcpSummary: config.capabilityPolicy.skillMcpAllowlist,
    currentLoad: {
      activeSubSessions: 1,
      queuedSubSessions: 0,
      failedSubSessions: 0,
      completedSubSessions: 0,
      maxParallelSessions: config.delegation.maxParallelSessions,
      utilization: 0.5,
    },
    failureRate: {
      windowMs: 86_400_000,
      consideredSubSessions: 2,
      failedSubSessions: 0,
      value: 0,
    },
  }
}

describe("task006 orchestration agent quick edit", () => {
  it("renders a compact core quick edit with only the main fields visible by default", () => {
    const draft = createBoardAgentDraft({
      draft: createOrchestrationBoardDraft({ agents: [], teams: [] }),
      displayName: "Agent draft",
      randomSuffix: () => "a1b2",
    })
    const agent = draft.agents[0]!
    const html = renderToStaticMarkup(createElement(OrchestrationQuickEditSheet, {
      language: "en",
      selection: {
        kind: "agent",
        agent,
        runtimeAgent: buildRuntimeAgent(agent.config),
        teamLabels: ["Research lane"],
        issues: [],
        onPatch: () => undefined,
      },
    }))

    expect(html).toContain('data-orchestration-agent-quick-edit=""')
    expect(html).toContain("Research lane")
    expect(html).toContain("Display name")
    expect(html).toContain("Role")
    expect(html).toContain("Description")
    expect(html).toContain('placeholder="Enter name"')
    expect(html).toContain('placeholder="Enter role"')
    expect(html).toContain('placeholder="Enter description"')
    expect(html).toContain('data-orchestration-agent-status-options=""')
    expect(html).not.toContain("Core policy summary")
    expect(html).not.toContain("Status summary")
    expect(html).not.toContain("teamIds")
  })

  it("keeps preset changes aligned with the effective policy defaults", () => {
    const draft = createBoardAgentDraft({
      draft: createOrchestrationBoardDraft({ agents: [], teams: [] }),
      displayName: "Agent draft",
      randomSuffix: () => "a1b2",
    })

    const patched = patchBoardAgentDraft({
      draft,
      agentId: draft.agents[0]!.agentId,
      patch: {
        rolePresetId: "operator",
        riskPresetId: "workspace_write",
        capabilityPresetId: "workspace_tools",
      },
    })
    const agent = patched.agents[0]!.config

    expect(agent.role).toBe(AGENT_ROLE_PRESETS.operator.role)
    expect(agent.personality).toBe(AGENT_ROLE_PRESETS.operator.personality)
    expect(agent.capabilityPolicy.permissionProfile.riskCeiling).toBe("sensitive")
    expect(agent.capabilityPolicy.permissionProfile.allowFilesystemWrite).toBe(true)
    expect(agent.capabilityPolicy.permissionProfile.allowShellExecution).toBe(true)
    expect(agent.capabilityPolicy.skillMcpAllowlist.enabledToolNames).toEqual(AGENT_CAPABILITY_PRESETS.workspace_tools.enabledToolNames)
    expect(agent.delegation.enabled).toBe(false)
    expect(agent.memoryPolicy.visibility).toBe("private")
  })

  it("preserves trailing spaces while editing agent and team text fields", () => {
    const base = createOrchestrationBoardDraft({ agents: [], teams: [] })
    const withAgent = createBoardAgentDraft({
      draft: base,
      displayName: "Agent draft",
      randomSuffix: () => "a1b2",
    })
    const withTeam = createBoardTeamDraft({
      draft: withAgent,
      displayName: "Team draft",
      randomSuffix: () => "t9k3",
    })

    const patchedAgent = patchBoardAgentDraft({
      draft: withTeam,
      agentId: withTeam.agents[0]!.agentId,
      patch: {
        displayName: "한글 이름 ",
        role: "조사 담당 ",
        personality: "메모 입력 ",
      },
    })
    const patchedTeam = patchBoardTeamDraft({
      draft: patchedAgent,
      teamId: patchedAgent.teams[0]!.teamId,
      patch: {
        displayName: "검토 팀 ",
        purpose: "근거를 검토 하고 정리 ",
      },
    })

    expect(patchedTeam.agents[0]!.config.displayName).toBe("한글 이름 ")
    expect(patchedTeam.agents[0]!.config.role).toBe("조사 담당 ")
    expect(patchedTeam.agents[0]!.config.personality).toBe("메모 입력 ")
    expect(patchedTeam.teams[0]!.config.displayName).toBe("검토 팀 ")
    expect(patchedTeam.teams[0]!.config.purpose).toBe("근거를 검토 하고 정리 ")
  })

  it("keeps empty quick-edit text fields empty instead of restoring ids or default copy", () => {
    const base = createOrchestrationBoardDraft({ agents: [], teams: [] })
    const withAgent = createBoardAgentDraft({
      draft: base,
      displayName: "Agent draft",
      randomSuffix: () => "a1b2",
    })
    const withTeam = createBoardTeamDraft({
      draft: withAgent,
      displayName: "Team draft",
      randomSuffix: () => "t9k3",
    })

    const patchedAgent = patchBoardAgentDraft({
      draft: withTeam,
      agentId: withTeam.agents[0]!.agentId,
      patch: {
        displayName: "",
        role: "",
        personality: "",
      },
    })
    const patchedTeam = patchBoardTeamDraft({
      draft: patchedAgent,
      teamId: patchedAgent.teams[0]!.teamId,
      patch: {
        displayName: "",
        purpose: "",
      },
    })

    expect(patchedTeam.agents[0]!.config.displayName).toBe("")
    expect(patchedTeam.agents[0]!.config.role).toBe("")
    expect(patchedTeam.agents[0]!.config.personality).toBe("")
    expect(patchedTeam.teams[0]!.config.displayName).toBe("")
    expect(patchedTeam.teams[0]!.config.purpose).toBe("")
    expect(patchedTeam.agents[0]!.config.displayName).not.toBe(patchedTeam.agents[0]!.agentId)
    expect(patchedTeam.teams[0]!.config.displayName).not.toBe(patchedTeam.teams[0]!.teamId)
  })
})
