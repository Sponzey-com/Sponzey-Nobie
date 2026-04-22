import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import { OrchestrationAdvancedFoldout } from "../packages/webui/src/components/orchestration/OrchestrationAdvancedFoldout.tsx"
import { createOrchestrationBoardDraft } from "../packages/webui/src/lib/orchestration-board.ts"
import { createBoardAgentDraft } from "../packages/webui/src/lib/orchestration-board-editing.ts"

describe("task006 orchestration advanced foldout", () => {
  it("keeps advanced identity, capability fields, and policy overlay behind the foldout", () => {
    const draft = createBoardAgentDraft({
      draft: createOrchestrationBoardDraft({ agents: [], teams: [] }),
      displayName: "Agent draft",
      randomSuffix: () => "a1b2",
    })
    const baseAgent = draft.agents[0]!
    const agent = {
      ...baseAgent,
      persisted: true,
      lockedId: true,
      config: {
        ...baseAgent.config,
        capabilityPolicy: {
          ...baseAgent.config.capabilityPolicy,
          skillMcpAllowlist: {
            ...baseAgent.config.capabilityPolicy.skillMcpAllowlist,
            disabledToolNames: ["shell_exec"],
            secretScopeId: "secret:agent-alpha",
          },
        },
      },
    }

    const html = renderToStaticMarkup(createElement(OrchestrationAdvancedFoldout, {
      language: "en",
      agent,
      onPatch: () => undefined,
    }))

    expect(html).toContain('data-orchestration-advanced-foldout=""')
    expect(html).toContain('data-orchestration-id-field="agent"')
    expect(html).toContain("Saved entries keep a locked ID.")
    expect(html).toContain("Risk ceiling")
    expect(html).toContain("Approval boundary")
    expect(html).toContain("Enabled skills")
    expect(html).toContain("Enabled MCP servers")
    expect(html).toContain("Disabled tools")
    expect(html).toContain("Secret scope")
    expect(html).toContain("Rate limit")
  })
})
