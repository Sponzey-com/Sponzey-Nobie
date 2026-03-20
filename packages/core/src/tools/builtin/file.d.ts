import type { AgentTool } from "../types.js";
export declare function assertAllowedPath(filePath: string): void;
interface FileReadParams {
    path: string;
    encoding?: string;
}
export declare const fileReadTool: AgentTool<FileReadParams>;
interface FileWriteParams {
    path: string;
    content: string;
    createDirs?: boolean;
}
export declare const fileWriteTool: AgentTool<FileWriteParams>;
interface FileListParams {
    path: string;
    recursive?: boolean;
    pattern?: string;
    showHidden?: boolean;
}
export declare const fileListTool: AgentTool<FileListParams>;
interface FilePatchParams {
    patch: string;
}
export declare const filePatchTool: AgentTool<FilePatchParams>;
interface FileDeleteParams {
    path: string;
}
export declare const fileDeleteTool: AgentTool<FileDeleteParams>;
export {};
//# sourceMappingURL=file.d.ts.map