import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig, type NobieConfig } from "../packages/core/src/config/index.js"
import { closeDb, getDb } from "../packages/core/src/db/index.js"
import { runDoctor } from "../packages/core/src/diagnostics/doctor.js"
import {
  activateExtensionWithTrustPolicy,
  buildExtensionRegistrySnapshot,
  createExtensionRollbackPoint,
  getExtensionFailureState,
  recordExtensionFailure,
  recordExtensionToolFailure,
  resetExtensionFailureState,
  rollbackExtensionToPoint,
  runExtensionHookSafely,
} from "../packages/core/src/security/extension-governance.js"
import { ToolDispatcher } from "../packages/core/src/tools/dispatcher.js"

const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const tempDirs: string[] = []

function baseConfig(overrides = ""): string {
  return `{
    ai: { connection: { provider: "ollama", endpoint: "http://127.0.0.1:11434", model: "llama3.2" } },
    webui: { enabled: true, host: "127.0.0.1", port: 18181, auth: { enabled: false } },
    security: { approvalMode: "off" },
    memory: { searchMode: "fts", sessionRetentionDays: 30 },
    scheduler: { enabled: false, timezone: "Asia/Seoul" },
    mcp: { servers: {} },
    skills: { items: [] }
    ${overrides}
  }`
}

function useTempConfig(configText = baseConfig()): string {
  closeDb()
  resetExtensionFailureState()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task011-ext-"))
  tempDirs.push(stateDir)
  const configPath = join(stateDir, "config.json5")
  writeFileSync(configPath, configText, "utf-8")
  process.env["NOBIE_STATE_DIR"] = stateDir
  process.env["NOBIE_CONFIG"] = configPath
  reloadConfig()
  return stateDir
}

afterEach(() => {
  resetExtensionFailureState()
  closeDb()
  if (previousStateDir === undefined) delete process.env["NOBIE_STATE_DIR"]
  else process.env["NOBIE_STATE_DIR"] = previousStateDir
  if (previousConfig === undefined) delete process.env["NOBIE_CONFIG"]
  else process.env["NOBIE_CONFIG"] = previousConfig
  reloadConfig()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

beforeEach(() => {
  useTempConfig()
})

describe("task011 extension governance", () => {
  it("builds a registry contract with MCP, skill, and tool entries", () => {
    const skillPath = join(process.env["NOBIE_STATE_DIR"] ?? tmpdir(), "local-skill.md")
    writeFileSync(skillPath, "# local skill", "utf-8")
    const config: NobieConfig = {
      ...JSON.parse(JSON.stringify({
        profile: { profileName: "", displayName: "", language: "ko", timezone: "Asia/Seoul", workspace: "/tmp" },
        ai: { connection: { provider: "ollama", endpoint: "http://127.0.0.1:11434", model: "llama3.2" } },
        security: { allowedPaths: [], approvalMode: "off", approvalTimeout: 60, approvalTimeoutFallback: "deny", allowedCommands: [] },
        webui: { enabled: true, port: 18181, host: "127.0.0.1", auth: { enabled: false } },
        scheduler: { enabled: false, timezone: "Asia/Seoul" },
        mqtt: { enabled: false, host: "127.0.0.1", port: 1883, username: "", password: "", allowAnonymous: false },
        search: { web: { provider: "duckduckgo", maxResults: 5 } },
        memory: { sessionRetentionDays: 30 },
        orchestration: { maxDelegationTurns: 5 },
        mcp: { servers: { disabled: { enabled: false, command: "node", args: ["server.js"], toolTimeoutSec: 2 } } },
        skills: { items: [{ id: "local-skill", label: "Local Skill", description: "test", source: "local", path: skillPath, enabled: true }] },
      })),
    }
    const snapshot = buildExtensionRegistrySnapshot({
      config,
      tools: [{
        name: "internal_test",
        description: "internal",
        parameters: { type: "object", properties: {} },
        riskLevel: "safe",
        requiresApproval: false,
        execute: async () => ({ success: true, output: "ok" }),
      }],
      now: new Date("2026-04-17T00:00:00.000Z"),
    })

    expect(snapshot.kind).toBe("nobie.extension.registry")
    expect(snapshot.checksum).toHaveLength(64)
    expect(snapshot.entries.map((entry) => entry.id)).toEqual(expect.arrayContaining(["mcp:disabled", "skill:local-skill", "tool:internal_test"]))
    expect(snapshot.entries.find((entry) => entry.id === "mcp:disabled")?.status).toBe("disabled")
    expect(snapshot.entries.find((entry) => entry.id === "skill:local-skill")?.checksum).toHaveLength(64)
  })

  it("excludes degraded extension tools from candidates and dispatch", async () => {
    const dispatcher = new ToolDispatcher()
    dispatcher.register({
      name: "mcp__mock__danger",
      description: "mock MCP tool",
      parameters: { type: "object", properties: {} },
      riskLevel: "moderate",
      requiresApproval: false,
      execute: async () => ({ success: true, output: "should not run" }),
    })
    recordExtensionToolFailure({ toolName: "mcp__mock__danger", error: new Error("MCP mock:tools/call timed out after 1ms") })
    recordExtensionToolFailure({ toolName: "mcp__mock__danger", error: new Error("MCP mock:tools/call timed out after 1ms") })

    const toolNames = dispatcher.getAll().map((tool) => tool.name)
    const result = await dispatcher.dispatch("mcp__mock__danger", {}, {
      sessionId: "session-ext",
      runId: "run-ext",
      requestGroupId: "request-ext",
      workDir: process.cwd(),
      userMessage: "test",
      source: "webui",
      allowWebAccess: false,
      onProgress: () => undefined,
      signal: new AbortController().signal,
    })

    expect(getExtensionFailureState("mcp-tool:mcp__mock__danger")?.degraded).toBe(true)
    expect(toolNames).not.toContain("mcp__mock__danger")
    expect(result.success).toBe(false)
    expect(result.error).toBe("EXTENSION_ISOLATED")
  })

  it("isolates hook failure without throwing into the run", async () => {
    const result = await runExtensionHookSafely({ extensionId: "hook:test", hookName: "before_run", timeoutMs: 10 }, async () => {
      throw new Error("hook failed with raw stack\n    at secret (/private/path.js:1:1)")
    })
    const diagnostic = getDb()
      .prepare<[], { kind: string; summary: string }>("SELECT kind, summary FROM diagnostic_events ORDER BY created_at DESC LIMIT 1")
      .get()

    expect(result.ok).toBe(false)
    expect(diagnostic?.kind).toBe("extension_failure")
    expect(diagnostic?.summary).not.toContain("secret")
  })

  it("records MCP timeout diagnostics and surfaces degraded status in doctor", () => {
    recordExtensionFailure({ extensionId: "mcp:timeout", kind: "mcp_server", error: new Error("MCP timeout server timed out after 1ms") })
    recordExtensionFailure({ extensionId: "mcp:timeout", kind: "mcp_server", error: new Error("MCP timeout server timed out after 1ms") })
    const report = runDoctor({ mode: "quick", includeEnvironment: false, includeReleasePackage: false })
    const check = report.checks.find((item) => item.name === "extension.registry")

    expect(check?.status).toBe("warning")
    expect(JSON.stringify(check?.detail)).toContain("degradedCount")
  })

  it("requires approval for dangerous extension activation", () => {
    const entry = buildExtensionRegistrySnapshot({
      tools: [{
        name: "dangerous_plugin_tool",
        description: "dangerous",
        parameters: { type: "object", properties: {} },
        riskLevel: "dangerous",
        requiresApproval: true,
        execute: async () => ({ success: true, output: "ok" }),
      }],
    }).entries.find((item) => item.id === "tool:dangerous_plugin_tool")!

    const denied = activateExtensionWithTrustPolicy(entry, { approved: false })
    const allowed = activateExtensionWithTrustPolicy(entry, { approved: true })

    expect(denied.ok).toBe(false)
    expect(denied.reasonCode).toBe("approval_required")
    expect(allowed.ok).toBe(true)
  })

  it("creates rollback points and restores extension source checksum", () => {
    const sourcePath = join(process.env["NOBIE_STATE_DIR"] ?? tmpdir(), "plugin-entry.js")
    writeFileSync(sourcePath, "export default { name: 'demo', version: '1.0.0' }\n", "utf-8")
    const rollback = createExtensionRollbackPoint({ extensionId: "plugin:demo", sourcePath })
    writeFileSync(sourcePath, "export default { name: 'demo', version: '2.0.0' }\n", "utf-8")
    rollbackExtensionToPoint("plugin:demo")

    expect(readFileSync(sourcePath, "utf-8")).toContain("1.0.0")
    expect(rollback.checksum).toHaveLength(64)
  })
})
