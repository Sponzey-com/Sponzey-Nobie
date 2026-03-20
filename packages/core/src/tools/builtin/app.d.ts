import type { AgentTool } from "../types.js";
interface AppLaunchParams {
    app: string;
    args?: string[];
    background?: boolean;
}
interface AppListParams {
    filter?: string;
}
export declare const appLaunchTool: AgentTool<AppLaunchParams>;
export declare const appListTool: AgentTool<AppListParams>;
export {};
//# sourceMappingURL=app.d.ts.map