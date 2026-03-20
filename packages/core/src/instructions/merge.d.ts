import { type InstructionChain } from "./discovery.js";
export interface MergedInstructionBundle {
    chain: InstructionChain;
    mergedText: string;
}
export declare function loadMergedInstructions(workDir?: string): MergedInstructionBundle;
//# sourceMappingURL=merge.d.ts.map