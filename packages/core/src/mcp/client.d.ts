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
    callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpToolCallResult>;
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