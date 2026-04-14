/**
 * Mouse control tools.
 * Requires Yeonjang for execution.
 */
import type { AgentTool } from "../../types.js";
interface MouseMoveParams {
    x: number;
    y: number;
    extensionId?: string;
}
interface MouseClickParams {
    x: number;
    y: number;
    button?: "left" | "right" | "middle";
    double?: boolean;
    extensionId?: string;
}
interface MouseActionParams {
    action: "move" | "click" | "double_click" | "button_down" | "button_up" | "scroll";
    x?: number;
    y?: number;
    button?: "left" | "right" | "middle";
    deltaX?: number;
    deltaY?: number;
    extensionId?: string;
}
export declare const mouseMoveTool: AgentTool<MouseMoveParams>;
export declare const mouseClickTool: AgentTool<MouseClickParams>;
export declare const mouseActionTool: AgentTool<MouseActionParams>;
export {};
//# sourceMappingURL=mouse.d.ts.map