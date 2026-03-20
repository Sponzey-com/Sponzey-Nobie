import type { AgentTool } from "../types.js";
interface WebFetchParams {
    url: string;
    mode?: "text" | "screenshot" | "raw-html";
    waitForSelector?: string;
    maxLength?: number;
}
export declare const webFetchTool: AgentTool<WebFetchParams>;
export {};
//# sourceMappingURL=web-fetch.d.ts.map