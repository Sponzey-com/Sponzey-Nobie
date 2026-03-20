/**
 * Screen capture tools.
 * Uses @nut-tree/nut-js when available, falls back to platform CLI tools.
 */
import type { AgentTool } from "../../types.js";
export declare const screenCaptureTool: AgentTool<Record<string, never>>;
interface ScreenFindTextParams {
    text: string;
}
export declare const screenFindTextTool: AgentTool<ScreenFindTextParams>;
export {};
//# sourceMappingURL=screen.d.ts.map