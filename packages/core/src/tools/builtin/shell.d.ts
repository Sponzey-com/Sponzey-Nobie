import type { AgentTool } from "../types.js";
interface ShellExecParams {
    command: string;
    workDir?: string;
    timeoutSec?: number;
    env?: Record<string, string>;
}
export declare const shellExecTool: AgentTool<ShellExecParams>;
export {};
//# sourceMappingURL=shell.d.ts.map