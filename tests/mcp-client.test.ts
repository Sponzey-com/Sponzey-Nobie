import { afterEach, describe, expect, it } from "vitest"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { McpStdioClient } from "../packages/core/src/mcp/client.ts"
import { mcpRegistry } from "../packages/core/src/mcp/registry.ts"
import { toolDispatcher } from "../packages/core/src/tools/index.ts"
import { DEFAULT_CONFIG } from "../packages/core/src/config/types.ts"

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

    const result = await tool!.execute(
      { text: "from registry" },
      {
        sessionId: "test-session",
        runId: "test-run",
        workDir: process.cwd(),
        userMessage: "test",
        allowWebAccess: false,
        onProgress: () => {},
        signal: new AbortController().signal,
      },
    )

    expect(result.success).toBe(true)
    expect(result.output).toBe("from registry")
  })
})
