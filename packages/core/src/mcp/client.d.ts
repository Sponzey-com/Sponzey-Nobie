import type { AgentCapabilityCallContext } from "../security/capability-isolation.js";
export type McpTransport = "stdio" | "http";
export interface McpServerConfig {
    enabled?: boolean;
    transport?: McpTransport;
    command?: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    url?: string;
    required?: boolean;
    startupTimeoutSec?: number;
    toolTimeoutSec?: number;
    enabledTools?: string[];
    disabledTools?: string[];
}
export interface McpDiscoveredTool {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: Record<string, unknown>;
        required?: string[];
    };
}
export interface McpToolCallResult {
    output: string;
    details: unknown;
    isError: boolean;
}
export type McpAgentCallContext = AgentCapabilityCallContext;
export interface McpToolCallPayload extends Record<string, unknown> {
    name: string;
    arguments: Record<string, unknown>;
    _meta?: {
        nobie: {
            agent_id: string;
            session_id: string;
            permission_profile: {
                profile_id: string;
                risk_ceiling: string;
                approval_required_from: string;
                allow_external_network: boolean;
                allow_filesystem_write: boolean;
                allow_shell_execution: boolean;
                allow_screen_control: boolean;
            };
            secret_scope: string;
            audit_id: string;
            run_id?: string;
            request_group_id?: string;
            capability_delegation_id?: string;
        };
    };
}
export declare function buildMcpToolCallPayload(name: string, args: Record<string, unknown>, context?: McpAgentCallContext): McpToolCallPayload;
export declare class McpStdioClient {
    private readonly name;
    private readonly config;
    private readonly onExit;
    private process;
    private stdoutBuffer;
    private requestId;
    private initialized;
    private pending;
    private closedByUser;
    constructor(options: {
        name: string;
        config: McpServerConfig;
        onExit?: (error: string) => void;
    });
    initialize(): Promise<void>;
    listTools(): Promise<McpDiscoveredTool[]>;
    callTool(name: string, args: Record<string, unknown>, contextOrSignal?: McpAgentCallContext | AbortSignal, signal?: AbortSignal): Promise<McpToolCallResult>;
    close(): Promise<void>;
    private ensureProcess;
    private consumeFrames;
    private handleMessage;
    private notify;
    private request;
    private rejectAll;
    private startupTimeoutMs;
    private toolTimeoutMs;
}
//# sourceMappingURL=client.d.ts.map