import type { AgentTool } from "../types.js";
interface ProcessListParams {
    filter?: string;
    sortBy?: "cpu" | "memory" | "pid" | "name";
    limit?: number;
}
interface ProcessKillParams {
    pid?: number;
    name?: string;
    signal?: "SIGTERM" | "SIGKILL";
}
export declare const processListTool: AgentTool<ProcessListParams>;
export declare const processKillTool: AgentTool<ProcessKillParams>;
export {};
//# sourceMappingURL=process.d.ts.map