import type { AgentTool } from "../types.js";
interface MemoryStoreParams {
    content: string;
    tags?: string[];
    importance?: "low" | "medium" | "high";
}
export declare const memoryStoreTool: AgentTool<MemoryStoreParams>;
interface MemorySearchParams {
    query: string;
    limit?: number;
}
export declare const memorySearchTool: AgentTool<MemorySearchParams>;
interface FileSearchParams {
    query: string;
    limit?: number;
    mode?: "text" | "vector" | "hybrid";
}
export declare const fileSemanticSearchTool: AgentTool<FileSearchParams>;
export {};
//# sourceMappingURL=memory.d.ts.map