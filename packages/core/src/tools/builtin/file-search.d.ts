import type { AgentTool } from "../types.js";
interface FileSearchParams {
    query: string;
    searchIn?: "names" | "content" | "both" | undefined;
    paths?: string[] | undefined;
    includePatterns?: string[] | undefined;
    excludePatterns?: string[] | undefined;
    maxResults?: number | undefined;
    contextLines?: number | undefined;
    caseSensitive?: boolean | undefined;
}
export declare const fileSearchTool: AgentTool<FileSearchParams>;
export {};
//# sourceMappingURL=file-search.d.ts.map