/**
 * Mouse control tools. Uses @nut-tree/nut-js when available.
 * Dynamic import allows graceful failure if package not installed.
 */
import type { AgentTool } from "../../types.js";
interface MouseMoveParams {
    x: number;
    y: number;
}
export declare const mouseMoveTool: AgentTool<MouseMoveParams>;
interface MouseClickParams {
    x: number;
    y: number;
    button?: "left" | "right" | "middle";
    double?: boolean;
}
export declare const mouseClickTool: AgentTool<MouseClickParams>;
export {};
//# sourceMappingURL=mouse.d.ts.map