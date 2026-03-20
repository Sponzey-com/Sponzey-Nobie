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
}
export interface InstructionChain {
    workDir: string;
    gitRoot?: string;
    sources: InstructionSource[];
}
export declare function discoverInstructionChain(workDir?: string): InstructionChain;
//# sourceMappingURL=discovery.d.ts.map