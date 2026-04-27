import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { DEFAULT_CONFIG } from "../packages/core/src/config/types.ts"
import type { CapabilityPolicy } from "../packages/core/src/contracts/sub-agent-orchestration.ts"
import { McpStdioClient } from "../packages/core/src/mcp/client.ts"
import { mcpRegistry } from "../packages/core/src/mcp/registry.ts"
import { toolDispatcher } from "../packages/core/src/tools/index.ts"

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixture = resolve(__dirname, "fixtures/fake-mcp-server.mjs")

afterEach(async () => {
  await mcpRegistry.closeAll()
})

describe("MCP stdio client", () => {
  it("initializes a stdio MCP server and calls a tool", async () => {
    const client = new McpStdioClient({
      name: "fake",
      config: {
        command: process.execPath,
        args: [fixture],
        startupTimeoutSec: 3,
        toolTimeoutSec: 3,
      },
    })

    await client.initialize()
    const tools = await client.listTools()
    expect(tools.map((tool) => tool.name)).toEqual(["echo", "sum"])

    const result = await client.callTool("echo", { text: "hello mcp" })
    expect(result.output).toBe("hello mcp")

    await client.close()
  })

  it("registers MCP tools into the tool dispatcher", async () => {
    await mcpRegistry.loadFromConfig({
      ...DEFAULT_CONFIG,
      mcp: {
        servers: {
          fake: {
            command: process.execPath,
            args: [fixture],
            startupTimeoutSec: 3,
            toolTimeoutSec: 3,
          },
        },
      },
    })

    const tool = toolDispatcher.get("mcp__fake__echo")
    expect(tool).toBeDefined()

    const capabilityPolicy: CapabilityPolicy = {
      permissionProfile: {
        profileId: "profile:mcp-test",
        riskCeiling: "dangerous",
        approvalRequiredFrom: "dangerous",
        allowExternalNetwork: true,
        allowFilesystemWrite: false,
        allowShellExecution: false,
        allowScreenControl: false,
        allowedPaths: [],
      },
      skillMcpAllowlist: {
        enabledSkillIds: [],
        enabledMcpServerIds: ["fake"],
        enabledToolNames: ["mcp__fake__echo", "echo"],
        disabledToolNames: [],
        secretScopeId: "secret:mcp-test",
      },
      rateLimit: { maxConcurrentCalls: 1 },
    }
    const result = await toolDispatcher.dispatch(
      "mcp__fake__echo",
      { text: "from registry" },
      {
        sessionId: "test-session",
        runId: "test-run",
        requestGroupId: "test-group",
        workDir: process.cwd(),
        userMessage: "test",
        source: "cli",
        allowWebAccess: false,
        onProgress: () => {},
        signal: new AbortController().signal,
        agentId: "agent:mcp-test",
        agentType: "sub_agent",
        capabilityPolicy,
        secretScopeId: "secret:mcp-test",
        auditId: "audit:mcp-test",
      },
    )

    expect(result.success).toBe(true)
    expect(result.output).toBe("from registry")
  })
})
