import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import { OrchestrationAgentAvatar } from "../packages/webui/src/components/orchestration/OrchestrationAgentAvatar.tsx"
import { OrchestrationMapNode } from "../packages/webui/src/components/orchestration/OrchestrationMapNode.tsx"

describe("task001 orchestration node primitive", () => {
  it("renders deterministic agent avatars without external assets", () => {
    const html = renderToStaticMarkup(createElement(OrchestrationAgentAvatar, {
      seed: "agent-researcher-k4m2",
      displayName: "Research Scout",
      role: "Evidence researcher",
      mode: "character",
      size: "lg",
      tone: "ready",
    }))

    expect(html).toContain('data-orchestration-agent-avatar-mode="character"')
    expect(html).toContain('data-orchestration-agent-avatar=')
    expect(html).toContain(">RS<")
    expect(html).toContain(">RS<")
  })

  it("renders card and character node modes with separate config and runtime badge layers", () => {
    const cardHtml = renderToStaticMarkup(createElement(OrchestrationMapNode, {
      kind: "agent",
      mode: "card",
      tone: "warning",
      title: "Agent Delta",
      subtitle: "Workspace operator",
      eyebrow: "Agent",
      avatar: createElement(OrchestrationAgentAvatar, {
        seed: "agent-delta-d4",
        displayName: "Agent Delta",
        role: "Workspace operator",
      }),
      configBadges: ["enabled", "Sensitive risk"],
      runtimeBadges: ["Queued"],
      detailBadges: ["Delegation on"],
    }))
    const characterHtml = renderToStaticMarkup(createElement(OrchestrationMapNode, {
      kind: "team",
      mode: "character",
      tone: "ready",
      title: "Research Pod",
      subtitle: "Collect evidence and verify outputs.",
      configBadges: ["enabled"],
      runtimeBadges: ["Idle"],
    }))

    expect(cardHtml).toContain('data-orchestration-map-node="agent"')
    expect(cardHtml).toContain('data-orchestration-map-node-mode="card"')
    expect(cardHtml).toContain('data-orchestration-map-node-config=""')
    expect(cardHtml).toContain('data-orchestration-map-node-runtime=""')
    expect(cardHtml).toContain("Sensitive risk")
    expect(cardHtml).toContain("Queued")

    expect(characterHtml).toContain('data-orchestration-map-node="team"')
    expect(characterHtml).toContain('data-orchestration-map-node-mode="character"')
    expect(characterHtml).toContain("Research Pod")
    expect(characterHtml).toContain("Idle")
  })
})

