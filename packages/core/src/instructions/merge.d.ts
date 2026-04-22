import { type AgentInstructionSourceInput, type InstructionChain } from "./discovery.js";
export interface MergedInstructionBundle {
    chain: InstructionChain;
    mergedText: string;
}
export interface MergedInstructionOptions {
    agentSources?: AgentInstructionSourceInput[];
}
export declare function loadMergedInstructions(workDir?: string, options?: MergedInstructionOptions): MergedInstructionBundle;
//# sourceMappingURL=merge.d.ts.map