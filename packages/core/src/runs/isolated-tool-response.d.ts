import type { AgentChunk } from "../agent/index.js";
export interface IsolatedToolResponseDecision {
    kind: "none" | "artifact" | "text";
    text?: string;
}
export declare function decideIsolatedToolResponse(chunk: AgentChunk): IsolatedToolResponseDecision;
export declare function shouldTerminateRunAfterSuccessfulTool(chunk: AgentChunk): boolean;
//# sourceMappingURL=isolated-tool-response.d.ts.map