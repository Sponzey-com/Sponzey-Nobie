import { eventBus } from "../events/index.js"
import { insertAuditLog } from "../db/index.js"
import { createLogger } from "../logger/index.js"
import type { AgentTool, AnyTool, ToolContext, ToolResult } from "./types.js"

const log = createLogger("tools:dispatcher")

export class ToolDispatcher {
  private tools = new Map<string, AnyTool>()

  register(tool: AnyTool): void {
    this.tools.set(tool.name, tool)
    log.debug(`Registered tool: ${tool.name} (${tool.riskLevel})`)
  }

  registerAll(tools: AnyTool[]): void {
    for (const tool of tools) this.register(tool)
  }

  getAll(): AnyTool[] {
    return [...this.tools.values()]
  }

  get(name: string): AnyTool | undefined {
    return this.tools.get(name)
  }

  async dispatch(
    name: string,
    params: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name)
    if (!tool) {
      return {
        success: false,
        output: `Unknown tool: "${name}"`,
        error: `Tool "${name}" is not registered`,
      }
    }

    eventBus.emit("tool.before", {
      sessionId: ctx.sessionId,
      runId: ctx.runId,
      toolName: name,
      params,
    })

    const startMs = Date.now()
    let result: ToolResult

    if (tool.requiresApproval) {
      const approved = await this.requestApproval(name, params, ctx)
      if (!approved) {
        result = {
          success: false,
          output: `Execution of "${name}" was denied by the user.`,
          error: "denied",
        }
        this.writeAudit(ctx, name, params, result, Date.now() - startMs, true, "user")
        return result
      }
    }

    try {
      result = await tool.execute(params, ctx)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error(`Tool "${name}" threw an error: ${msg}`)
      result = { success: false, output: `Tool error: ${msg}`, error: msg }
    }

    const durationMs = Date.now() - startMs

    eventBus.emit("tool.after", {
      sessionId: ctx.sessionId,
      runId: ctx.runId,
      toolName: name,
      success: result.success,
      durationMs,
    })

    this.writeAudit(ctx, name, params, result, durationMs, tool.requiresApproval, undefined)

    return result
  }

  private async requestApproval(
    toolName: string,
    params: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let resolved = false

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true
          log.warn(`Approval timeout for tool "${toolName}" — denying by default`)
          resolve(false)
        }
      }, 60_000)

      eventBus.emit("approval.request", {
        runId: ctx.runId,
        toolName,
        params,
        resolve: (decision) => {
          if (!resolved) {
            resolved = true
            clearTimeout(timeout)
            resolve(decision === "allow")
          }
        },
      })
    })
  }

  private writeAudit(
    ctx: ToolContext,
    toolName: string,
    params: Record<string, unknown>,
    result: ToolResult,
    durationMs: number,
    approvalRequired: boolean,
    approvedBy?: string,
  ) {
    try {
      insertAuditLog({
        timestamp: Date.now(),
        session_id: ctx.sessionId,
        source: "agent",
        tool_name: toolName,
        params: JSON.stringify(params),
        result: result.error === "denied" ? "denied" : result.success ? "success" : "failed",
        duration_ms: durationMs,
        approval_required: approvalRequired ? 1 : 0,
        approved_by: approvedBy ?? null,
      })
    } catch {
      // best-effort
    }
  }
}

export const toolDispatcher = new ToolDispatcher()

export type { AgentTool, AnyTool, ToolContext, ToolResult, RiskLevel } from "./types.js"
