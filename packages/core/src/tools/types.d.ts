export type RiskLevel = "safe" | "moderate" | "dangerous";
export interface ToolContext {
    sessionId: string;
    runId: string;
    workDir: string;
    userMessage: string;
    allowWebAccess: boolean;
    onProgress: (message: string) => void;
    signal: AbortSignal;
}
export interface ToolResult {
    success: boolean;
    output: string;
    details?: unknown;
    error?: string | undefined;
}
export interface AgentTool<TParams = unknown> {
    name: string;
    description: string;
    parameters: {
        type: "object";
        properties: Record<string, unknown>;
        required?: string[];
    };
    riskLevel: RiskLevel;
    requiresApproval: boolean;
    execute(params: TParams, ctx: ToolContext): Promise<ToolResult>;
}
export type AnyTool = AgentTool<any>;
//# sourceMappingURL=types.d.ts.map