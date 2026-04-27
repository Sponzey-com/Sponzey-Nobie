import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { extname, join, normalize } from "node:path"
import { chromium } from "../packages/core/node_modules/playwright/index.mjs"

const root = join(process.cwd(), "packages/webui/dist")
const now = Date.UTC(2026, 3, 24, 0, 0, 0)

const setupState = {
  version: 1,
  completed: true,
  currentStep: "done",
  completedAt: now,
  skipped: { telegram: true, remoteAccess: true },
}

const setupDraft = {
  personal: {
    profileName: "smoke",
    displayName: "Smoke",
    language: "ko",
    timezone: "Asia/Seoul",
    workspace: process.cwd(),
  },
  aiBackends: [],
  routingProfiles: [],
  mcp: { servers: [] },
  skills: { items: [] },
  security: {
    approvalMode: "on-miss",
    approvalTimeout: 30,
    approvalTimeoutFallback: "deny",
    maxDelegationTurns: 5,
  },
  channels: {
    telegramEnabled: false,
    botToken: "",
    allowedUserIds: "",
    allowedGroupIds: "",
    slackEnabled: false,
    slackBotToken: "",
    slackAppToken: "",
    slackAllowedUserIds: "",
    slackAllowedChannelIds: "",
  },
  mqtt: { enabled: false, host: "127.0.0.1", port: 1883, username: "", password: "" },
  remoteAccess: { authEnabled: false, authToken: "", host: "127.0.0.1", port: 18888 },
}

const uiMode = {
  mode: "advanced",
  preferredUiMode: "advanced",
  availableModes: ["beginner", "advanced"],
  adminEnabled: false,
  canSwitchInUi: true,
  schemaVersion: 1,
}

const shell = {
  generatedAt: now,
  mode: uiMode,
  setupState: { completed: true },
  runtimeHealth: {
    ai: { configured: true, provider: "fixture", modelConfigured: true },
    channels: {
      webui: true,
      telegramConfigured: false,
      telegramEnabled: false,
      slackConfigured: false,
      slackEnabled: false,
    },
    yeonjang: { mqttEnabled: false, connectedExtensions: 0 },
  },
  activeRuns: { total: 0, pendingApprovals: 0 },
  viewModel: {
    currentMode: "advanced",
    current: { kind: "advanced", components: [] },
    beginner: {
      kind: "beginner",
      summary: "ready",
      statusLabel: "ready",
      primaryAction: null,
      needsAttention: false,
      safeDetails: [],
    },
    advanced: { kind: "advanced", components: [] },
  },
}

const topology = {
  ok: true,
  schemaVersion: 1,
  generatedAt: now,
  rootAgentId: "agent:nobie",
  nodes: [
    {
      id: "agent:agent:nobie",
      kind: "nobie",
      entityId: "agent:nobie",
      label: "Nobie",
      status: "enabled",
      position: { x: 80, y: 80 },
      badges: ["Nobie"],
      data: {},
      diagnostics: [],
    },
    {
      id: "agent:agent:alpha",
      kind: "sub_agent",
      entityId: "agent:alpha",
      label: "Alpha",
      status: "enabled",
      position: { x: 360, y: 80 },
      badges: ["SubAgent", "candidate"],
      data: {},
      diagnostics: [],
    },
    {
      id: "team:team:topology",
      kind: "team",
      entityId: "team:topology",
      label: "Topology Team",
      status: "enabled",
      position: { x: 80, y: 360 },
      badges: ["Team", "degraded"],
      data: { teamId: "team:topology" },
      diagnostics: [],
    },
    {
      id: "team-role:team:topology:agent:alpha:lead",
      kind: "team_role",
      entityId: "team:topology:agent:alpha:lead",
      label: "lead",
      status: "active",
      position: { x: 360, y: 360 },
      badges: ["TeamRole", "active"],
      data: { teamId: "team:topology", agentId: "agent:alpha" },
      diagnostics: [],
    },
  ],
  edges: [
    {
      id: "relationship:agent:nobie->agent:alpha",
      kind: "parent_child",
      source: "agent:agent:nobie",
      target: "agent:agent:alpha",
      label: "parent child",
      valid: true,
      style: "hierarchy",
      data: {},
      diagnostics: [],
    },
    {
      id: "membership:team:topology->team-role:team:topology:agent:alpha:lead",
      kind: "team_membership",
      source: "team:team:topology",
      target: "team-role:team:topology:agent:alpha:lead",
      label: "lead",
      valid: true,
      style: "membership",
      data: { teamId: "team:topology", agentId: "agent:alpha" },
      diagnostics: [],
    },
  ],
  inspectors: {
    agents: {
      "agent:alpha": {
        agentId: "agent:alpha",
        nodeId: "agent:agent:alpha",
        kind: "sub_agent",
        displayName: "Alpha",
        status: "enabled",
        role: "researcher",
        specialtyTags: ["research"],
        teamIds: ["team:topology"],
        source: "db",
        model: { providerId: "openai", modelId: "gpt-5.4-mini", reasonCodes: [] },
        skillMcp: {
          enabledSkillIds: ["research"],
          enabledMcpServerIds: ["browser"],
          enabledToolNames: ["web_search"],
          disabledToolNames: [],
          secretScope: "configured",
        },
        tools: {
          enabledCount: 1,
          disabledCount: 0,
          enabledToolNames: ["web_search"],
          disabledToolNames: [],
        },
        memory: {
          owner: "sub_agent:agent:alpha",
          visibility: "private",
          readScopeCount: 1,
          readScopes: ["sub_agent:agent:alpha"],
          writeScope: "sub_agent:agent:alpha",
          retentionPolicy: "short_term",
          writebackReviewRequired: true,
        },
        capability: {
          allowExternalNetwork: true,
          allowFilesystemWrite: false,
          allowShellExecution: false,
          allowScreenControl: false,
          allowedPathCount: 0,
          reasonCodes: [],
        },
        delegation: { enabled: true, maxParallelSessions: 2, retryBudget: 2 },
        diagnostics: [],
      },
    },
    teams: {
      "team:topology": {
        teamId: "team:topology",
        nodeId: "team:team:topology",
        displayName: "Topology Team",
        status: "enabled",
        purpose: "Smoke test",
        ownerAgentId: "agent:nobie",
        leadAgentId: "agent:alpha",
        memberAgentIds: ["agent:alpha"],
        activeMemberAgentIds: ["agent:alpha"],
        roleHints: ["lead"],
        requiredTeamRoles: ["lead"],
        requiredCapabilityTags: ["research"],
        members: [
          {
            agentId: "agent:alpha",
            label: "Alpha",
            primaryRole: "lead",
            teamRoles: ["lead"],
            required: true,
            executionState: "active",
            directChild: true,
            active: true,
            reasonCodes: [],
            specialtyTags: ["research"],
            capabilityIds: ["research"],
          },
        ],
        roleCoverage: {
          required: ["lead"],
          covered: ["lead"],
          missing: [],
          providers: { lead: ["agent:alpha"] },
        },
        capabilityCoverage: {
          required: ["research"],
          covered: ["research"],
          missing: [],
          providers: { research: ["agent:alpha"] },
        },
        health: {
          status: "healthy",
          executionCandidate: true,
          activeMemberCount: 1,
          referenceMemberCount: 0,
          unresolvedMemberCount: 0,
          excludedMemberCount: 0,
          degradedReasonCodes: [],
        },
        builder: {
          ownerAgentId: "agent:nobie",
          directChildAgentIds: ["agent:alpha"],
          candidates: [
            {
              agentId: "agent:alpha",
              label: "Alpha",
              directChild: true,
              configuredMember: true,
              active: true,
              canActivate: true,
              membershipStatus: "active",
              primaryRole: "lead",
              teamRoles: ["lead"],
              reasonCodes: [],
            },
          ],
        },
        diagnostics: [],
      },
    },
  },
  layout: { schemaVersion: 1, layout: "tree", nodes: {}, updatedAt: null },
  diagnostics: [],
  validation: {
    hierarchy: { maxDepth: 5, maxChildCount: 10 },
    teamActiveMembershipRule: "owner_direct_child_required",
  },
}

const operationsSummary = {
  activeRuns: 0,
  queuedRuns: 0,
  failedRuns: 0,
  completedRuns: 0,
  staleRuns: 0,
  pendingApprovals: 0,
}

function json(res, value) {
  res.writeHead(200, { "content-type": "application/json; charset=utf-8" })
  res.end(JSON.stringify(value))
}

function contentType(pathname) {
  switch (extname(pathname)) {
    case ".js":
      return "text/javascript; charset=utf-8"
    case ".css":
      return "text/css; charset=utf-8"
    case ".html":
      return "text/html; charset=utf-8"
    default:
      return "application/octet-stream"
  }
}

function server() {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1")
    if (url.pathname === "/api/status") {
      json(res, {
        version: "task025",
        provider: "fixture",
        model: "fixture",
        uptime: 1,
        toolCount: 0,
        setupCompleted: true,
        capabilityCounts: { ready: 0, disabled: 0, planned: 0, error: 0 },
        primaryAiTarget: null,
        orchestratorStatus: { status: "ready", reason: null, mode: "orchestration" },
        startupRecovery: {
          createdAt: now,
          totalActiveRuns: 0,
          recoveredRunCount: 0,
          interruptedRunCount: 0,
          awaitingApprovalCount: 0,
          pendingDeliveryCount: 0,
          deliveredCount: 0,
          staleCount: 0,
          interruptedScheduleRunCount: 0,
          userFacingSummary: "ready",
        },
        fast_response_health: {
          generatedAt: now,
          status: "ok",
          reason: "ok",
          recentWindowMs: 60_000,
          metrics: [],
          recentTimeouts: [],
        },
        mcp: { serverCount: 0, readyCount: 0, toolCount: 0, requiredFailures: 0 },
        mqtt: {
          enabled: false,
          running: false,
          host: "127.0.0.1",
          port: 1883,
          url: "",
          clientCount: 0,
          authEnabled: false,
          allowAnonymous: true,
          reason: null,
        },
        paths: {
          stateDir: "/tmp",
          configFile: "/tmp/config.json5",
          dbFile: "/tmp/nobie.db",
          setupStateFile: "/tmp/setup.json",
        },
        webui: { port: 0, host: "127.0.0.1", authEnabled: false },
        update: {
          status: "idle",
          latestVersion: null,
          checkedAt: null,
          updateAvailable: false,
        },
      })
      return
    }
    if (url.pathname === "/api/capabilities") return json(res, { items: [], generatedAt: now })
    if (url.pathname === "/api/setup/status") return json(res, setupState)
    if (url.pathname === "/api/setup/draft") return json(res, setupDraft)
    if (url.pathname === "/api/setup/checks") return json(res, { checks: [], generatedAt: now })
    if (url.pathname === "/api/ui/shell") return json(res, shell)
    if (url.pathname === "/api/runs") return json(res, { runs: [] })
    if (url.pathname === "/api/tasks") return json(res, { tasks: [] })
    if (url.pathname === "/api/runs/operations/summary") {
      return json(res, { summary: operationsSummary })
    }
    if (url.pathname === "/api/agent-topology") return json(res, topology)

    const pathname = url.pathname.startsWith("/assets/") ? url.pathname : "/index.html"
    const target = normalize(join(root, pathname))
    if (!target.startsWith(root)) {
      res.writeHead(403)
      res.end("forbidden")
      return
    }
    try {
      const body = await readFile(target)
      res.writeHead(200, { "content-type": contentType(target) })
      res.end(body)
    } catch {
      res.writeHead(404)
      res.end("not found")
    }
  })
}

async function main() {
  const http = server()
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve))
  const address = http.address()
  const port = typeof address === "object" && address ? address.port : 0
  const url = `http://127.0.0.1:${port}/advanced/topology`
  const browser = await chromium.launch({ headless: true })
  try {
    for (const viewport of [
      { name: "desktop", width: 1280, height: 820 },
      { name: "mobile", width: 390, height: 844 },
    ]) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
      })
      await page.goto(url, { waitUntil: "networkidle" })
      await page.locator(".react-flow").waitFor({ state: "visible", timeout: 10_000 })
      await page.getByText("Agent Topology").waitFor({ state: "visible" })
      await page.getByText("Alpha").first().click()
      await page.getByText("Agent Inspector").waitFor({ state: "visible" })
      const box = await page.locator(".react-flow").boundingBox()
      if (!box || box.width < 240 || box.height < 320) {
        throw new Error(`${viewport.name} React Flow canvas is too small`)
      }
      await page.close()
    }
    console.log("task025 Playwright smoke ok")
  } finally {
    await browser.close()
    await new Promise((resolve) => http.close(resolve))
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
