import { type NobieConfig } from "../config/index.js";
import { type McpTransport } from "./client.js";
export interface McpToolStatus {
    name: string;
    registeredName: string;
    description: string;
}
export interface McpServerStatus {
    name: string;
    transport: McpTransport;
    enabled: boolean;
    required: boolean;
    ready: boolean;
    toolCount: number;
    registeredToolCount: number;
    command?: string;
    url?: string;
    error?: string;
    tools: McpToolStatus[];
}
export interface McpSummary {
    serverCount: number;
    readyCount: number;
    toolCount: number;
    requiredFailures: number;
}
export declare function toRegisteredToolName(serverName: string, toolName: string): string;
declare class McpRegistry {
    private readonly entries;
    loadFromConfig(config?: NobieConfig): Promise<void>;
    reloadFromConfig(): Promise<McpServerStatus[]>;
    getStatuses(): McpServerStatus[];
    getSummary(): McpSummary;
    closeAll(): Promise<void>;
    private loadServer;
    private registerTools;
    private unregisterTools;
}
export declare const mcpRegistry: McpRegistry;
export {};
//# sourceMappingURL=registry.d.ts.map