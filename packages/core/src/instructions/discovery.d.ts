export interface InstructionSource {
    path: string;
    scope: "global" | "project";
    level: number;
    exists: boolean;
    loaded: boolean;
    size: number;
    mtimeMs?: number;
    content?: string;
    error?: string;
    sourceKind?: "instruction_file" | "agent_prompt";
    agentId?: string;
    agentType?: "nobie" | "sub_agent";
    sourceId?: string;
}
export interface InstructionChain {
    workDir: string;
    gitRoot?: string;
    sources: InstructionSource[];
}
export interface AgentInstructionSourceInput {
    agentId: string;
    agentType: "nobie" | "sub_agent";
    sourceId: string;
    content: string;
    version?: string;
}
export interface InstructionDiscoveryOptions {
    agentSources?: AgentInstructionSourceInput[];
}
export declare function discoverInstructionChain(workDir?: string, options?: InstructionDiscoveryOptions): InstructionChain;
//# sourceMappingURL=discovery.d.ts.map