import { spawn } from "node:child_process";
import { createLogger } from "../logger/index.js";
const log = createLogger("mcp:client");
const DEFAULT_PROTOCOL_VERSION = "2024-11-05";
function toObject(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
}
function toArray(value) {
    return Array.isArray(value) ? value : [];
}
function toStringArray(value) {
    return Array.isArray(value)
        ? value.filter((item) => typeof item === "string")
        : [];
}
function normalizeInputSchema(value) {
    const raw = toObject(value);
    const properties = toObject(raw.properties);
    const required = toStringArray(raw.required);
    return {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
    };
}
function extractToolOutput(payload) {
    const raw = toObject(payload);
    const textParts = toArray(raw.content)
        .map((item) => {
        const row = toObject(item);
        if (row.type === "text" && typeof row.text === "string")
            return row.text;
        if (row.type === "image" && typeof row.mimeType === "string")
            return `[image:${row.mimeType}]`;
        if (row.type === "resource" && typeof row.uri === "string")
            return `[resource:${row.uri}]`;
        return "";
    })
        .filter((value) => value.trim().length > 0);
    if (textParts.length > 0) {
        return textParts.join("\n").trim();
    }
    return JSON.stringify(payload, null, 2);
}
function isAbortSignal(value) {
    return Boolean(value &&
        typeof value === "object" &&
        "aborted" in value &&
        typeof value.addEventListener === "function");
}
export function buildMcpToolCallPayload(name, args, context) {
    if (!context) {
        return { name, arguments: args };
    }
    return {
        name,
        arguments: args,
        _meta: {
            nobie: {
                agent_id: context.agentId,
                session_id: context.sessionId,
                ...(context.bindingId ? { binding_id: context.bindingId } : {}),
                ...(context.clientSessionId ? { client_session_id: context.clientSessionId } : {}),
                permission_profile: {
                    profile_id: context.permissionProfile.profileId,
                    risk_ceiling: context.permissionProfile.riskCeiling,
                    approval_required_from: context.permissionProfile.approvalRequiredFrom,
                    allow_external_network: context.permissionProfile.allowExternalNetwork,
                    allow_filesystem_write: context.permissionProfile.allowFilesystemWrite,
                    allow_shell_execution: context.permissionProfile.allowShellExecution,
                    allow_screen_control: context.permissionProfile.allowScreenControl,
                },
                secret_scope: context.secretScopeId,
                audit_id: context.auditId,
                ...(context.runId ? { run_id: context.runId } : {}),
                ...(context.requestGroupId ? { request_group_id: context.requestGroupId } : {}),
                ...(context.capabilityDelegationId
                    ? { capability_delegation_id: context.capabilityDelegationId }
                    : {}),
            },
        },
    };
}
export class McpStdioClient {
    name;
    config;
    onExit;
    process = null;
    stdoutBuffer = Buffer.alloc(0);
    requestId = 0;
    initialized = false;
    pending = new Map();
    closedByUser = false;
    constructor(options) {
        this.name = options.name;
        this.config = options.config;
        this.onExit = options.onExit;
    }
    async initialize() {
        if (this.initialized)
            return;
        await this.ensureProcess();
        await this.request("initialize", {
            protocolVersion: DEFAULT_PROTOCOL_VERSION,
            clientInfo: {
                name: "nobie",
                version: "0.1.0",
            },
            capabilities: {},
        }, this.startupTimeoutMs());
        await this.notify("notifications/initialized", {});
        this.initialized = true;
    }
    async listTools() {
        await this.initialize();
        const response = toObject(await this.request("tools/list", {}, this.toolTimeoutMs()));
        return toArray(response.tools)
            .map((tool) => {
            const row = toObject(tool);
            if (typeof row.name !== "string" || !row.name.trim())
                return null;
            return {
                name: row.name.trim(),
                description: typeof row.description === "string" ? row.description.trim() : "",
                inputSchema: normalizeInputSchema(row.inputSchema),
            };
        })
            .filter((tool) => tool !== null);
    }
    async callTool(name, args, contextOrSignal, signal) {
        await this.initialize();
        const context = isAbortSignal(contextOrSignal) ? undefined : contextOrSignal;
        const resolvedSignal = isAbortSignal(contextOrSignal) ? contextOrSignal : signal;
        const response = await this.request("tools/call", buildMcpToolCallPayload(name, args, context), this.toolTimeoutMs(), resolvedSignal);
        const payload = toObject(response);
        return {
            output: extractToolOutput(payload),
            details: payload,
            isError: Boolean(payload.isError),
        };
    }
    async close() {
        this.closedByUser = true;
        this.initialized = false;
        this.rejectAll(new Error(`MCP server "${this.name}" was closed.`));
        const child = this.process;
        this.process = null;
        if (!child)
            return;
        child.stdout.removeAllListeners();
        child.stderr.removeAllListeners();
        child.removeAllListeners();
        if (!child.killed) {
            child.kill();
        }
    }
    async ensureProcess() {
        if (this.process)
            return;
        const command = this.config.command?.trim();
        if (!command) {
            throw new Error(`MCP server "${this.name}" command가 비어 있습니다.`);
        }
        const child = spawn(command, this.config.args ?? [], {
            cwd: this.config.cwd || process.cwd(),
            env: {
                ...process.env,
                ...(this.config.env ?? {}),
            },
            stdio: ["pipe", "pipe", "pipe"],
        });
        child.stdout.on("data", (chunk) => {
            this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);
            this.consumeFrames();
        });
        child.stderr.on("data", (chunk) => {
            const text = chunk.toString("utf8").trim();
            if (text)
                log.warn(`[${this.name}] ${text}`);
        });
        child.on("error", (error) => {
            const message = error instanceof Error ? error.message : String(error);
            this.rejectAll(new Error(`MCP server "${this.name}" process error: ${message}`));
            if (!this.closedByUser) {
                this.onExit?.(`MCP server "${this.name}" process error: ${message}`);
            }
        });
        child.on("exit", (code, signal) => {
            this.process = null;
            this.initialized = false;
            const message = code !== null
                ? `MCP server "${this.name}" exited with code ${code}.`
                : `MCP server "${this.name}" exited with signal ${signal ?? "unknown"}.`;
            this.rejectAll(new Error(message));
            if (!this.closedByUser) {
                this.onExit?.(message);
            }
        });
        this.closedByUser = false;
        this.process = child;
        log.info(`started MCP stdio server ${this.name}`);
    }
    consumeFrames() {
        while (true) {
            const headerEnd = this.stdoutBuffer.indexOf("\r\n\r\n");
            if (headerEnd === -1)
                return;
            const header = this.stdoutBuffer.subarray(0, headerEnd).toString("utf8");
            const match = header.match(/Content-Length:\s*(\d+)/i);
            if (!match) {
                this.stdoutBuffer = this.stdoutBuffer.subarray(headerEnd + 4);
                continue;
            }
            const bodyLength = Number(match[1]);
            const totalLength = headerEnd + 4 + bodyLength;
            if (this.stdoutBuffer.length < totalLength)
                return;
            const body = this.stdoutBuffer.subarray(headerEnd + 4, totalLength).toString("utf8");
            this.stdoutBuffer = this.stdoutBuffer.subarray(totalLength);
            try {
                const message = JSON.parse(body);
                this.handleMessage(message);
            }
            catch (error) {
                log.warn(`failed to parse MCP message from ${this.name}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
    handleMessage(message) {
        if (typeof message.id !== "number")
            return;
        const pending = this.pending.get(message.id);
        if (!pending)
            return;
        clearTimeout(pending.timeout);
        this.pending.delete(message.id);
        const maybeError = message.error;
        if (maybeError) {
            pending.reject(new Error(maybeError.message ?? `MCP request ${message.id} failed.`));
            return;
        }
        pending.resolve(message.result);
    }
    async notify(method, params) {
        await this.ensureProcess();
        const child = this.process;
        if (!child)
            throw new Error(`MCP server "${this.name}" process is not available.`);
        const payload = JSON.stringify({ jsonrpc: "2.0", method, params });
        child.stdin.write(`Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`);
    }
    async request(method, params, timeoutMs, signal) {
        await this.ensureProcess();
        const child = this.process;
        if (!child)
            throw new Error(`MCP server "${this.name}" process is not available.`);
        return new Promise((resolve, reject) => {
            const id = ++this.requestId;
            const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`MCP ${this.name}:${method} timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timeout });
            if (signal) {
                signal.addEventListener("abort", () => {
                    const pending = this.pending.get(id);
                    if (!pending)
                        return;
                    clearTimeout(pending.timeout);
                    this.pending.delete(id);
                    reject(new Error(`MCP ${this.name}:${method} was aborted.`));
                }, { once: true });
            }
            child.stdin.write(`Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`);
        });
    }
    rejectAll(error) {
        for (const [id, pending] of this.pending) {
            clearTimeout(pending.timeout);
            pending.reject(error);
            this.pending.delete(id);
        }
    }
    startupTimeoutMs() {
        return Math.max(1, this.config.startupTimeoutSec ?? 10) * 1000;
    }
    toolTimeoutMs() {
        return Math.max(1, this.config.toolTimeoutSec ?? 30) * 1000;
    }
}
//# sourceMappingURL=client.js.map