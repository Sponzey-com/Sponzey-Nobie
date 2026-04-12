/**
 * Screen capture tools.
 * Uses @nut-tree/nut-js when available, falls back to platform CLI tools.
 */
import type { AgentTool } from "../../types.js";
interface ScreenCaptureParams {
    extensionId?: string;
    display?: number | string;
}
interface ScreenFindTextParams {
    text: string;
    extensionId?: string;
}
export declare const screenCaptureTool: AgentTool<ScreenCaptureParams>;
export declare const screenFindTextTool: AgentTool<ScreenFindTextParams>;
export {};
//# sourceMappingURL=screen.d.ts.map