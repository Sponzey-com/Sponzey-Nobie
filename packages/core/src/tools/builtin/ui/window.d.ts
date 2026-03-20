/**
 * Window management tools - platform-specific.
 */
import type { AgentTool } from "../../types.js";
export declare const windowListTool: AgentTool<Record<string, never>>;
interface WindowFocusParams {
    title: string;
}
export declare const windowFocusTool: AgentTool<WindowFocusParams>;
export {};
//# sourceMappingURL=window.d.ts.map