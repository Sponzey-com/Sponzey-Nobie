import { describe, expect, it } from "vitest"
import { validateAgentConfig, validateTeamConfig } from "../packages/core/src/contracts/sub-agent-orchestration.ts"
import {
  buildPresetSubAgentConfig,
  buildPresetTeamConfig,
  inferAgentCapabilityPresetId,
  inferAgentRiskPresetId,
  inferAgentRolePresetId,
  inferTeamPurposePresetId,
} from "../packages/webui/src/lib/orchestration-presets.ts"

const now = Date.UTC(2026, 3, 21, 0, 0, 0)

describe("task001 orchestration preset builders", () => {
  it("builds a disabled sub-agent config with hidden required fields filled by presets", () => {
    const config = buildPresetSubAgentConfig({
      agentId: "agent-researcher-k4m2",
      displayName: "Researcher",
      rolePresetId: "researcher",
      riskPresetId: "safe_read",
      capabilityPresetId: "browser_research",
      teamIds: ["team-research-core-7d1p"],
      now,
    })
    const validation = validateAgentConfig(config)

    expect(validation.ok).toBe(true)
    expect(config.status).toBe("disabled")
    expect(config.personality.length).toBeGreaterThan(0)
    expect(config.memoryPolicy.owner.ownerId).toBe("agent-researcher-k4m2")
    expect(config.capabilityPolicy.permissionProfile.profileId).toBe("profile:agent-researcher-k4m2")
    expect(config.capabilityPolicy.permissionProfile.allowExternalNetwork).toBe(true)
    expect(config.capabilityPolicy.skillMcpAllowlist.enabledMcpServerIds).toEqual(["browser"])
  })

  it("builds a disabled team config with generated role hints and a validation-safe default purpose", () => {
    const config = buildPresetTeamConfig({
      teamId: "team-build-pod-4hqs",
      displayName: "Build Pod",
      purposePresetId: "build_pod",
      memberAgentIds: ["agent-builder-a1", "agent-reviewer-b2"],
      now,
    })
    const validation = validateTeamConfig(config)

    expect(validation.ok).toBe(true)
    expect(config.status).toBe("disabled")
    expect(config.roleHints).toEqual(["build lead", "build member"])
    expect(config.purpose).toContain("workspace changes")
  })

  it("infers preset ids from existing configs so the board can reopen saved entries without raw forms", () => {
    const agent = buildPresetSubAgentConfig({
      agentId: "agent-operator-q9w8",
      displayName: "Operator",
      rolePresetId: "operator",
      riskPresetId: "screen_control",
      capabilityPresetId: "workspace_tools",
      now,
    })
    const team = buildPresetTeamConfig({
      teamId: "team-ops-night-4hqs",
      displayName: "Ops Night",
      purposePresetId: "ops_pod",
      now,
    })

    expect(inferAgentRolePresetId(agent)).toBe("operator")
    expect(inferAgentRiskPresetId(agent)).toBe("screen_control")
    expect(inferAgentCapabilityPresetId(agent)).toBe("workspace_tools")
    expect(inferTeamPurposePresetId(team)).toBe("ops_pod")
  })
})
