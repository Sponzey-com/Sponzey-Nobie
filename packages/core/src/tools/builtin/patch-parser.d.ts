export type PatchOperation = {
    type: "update";
    filePath: string;
    hunks: Hunk[];
} | {
    type: "add";
    filePath: string;
    content: string;
} | {
    type: "delete";
    filePath: string;
};
export interface Hunk {
    context: string[];
    changes: Array<{
        op: "add" | "remove" | "context";
        line: string;
    }>;
}
export interface ParsedPatch {
    operations: PatchOperation[];
    hasDeletes: boolean;
}
export declare function parsePatch(patch: string): ParsedPatch;
//# sourceMappingURL=patch-parser.d.ts.map