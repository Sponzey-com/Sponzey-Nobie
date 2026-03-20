/**
 * Keyboard control tools. Uses @nut-tree/nut-js when available.
 */
import type { AgentTool } from "../../types.js";
interface KeyboardTypeParams {
    text: string;
}
export declare const keyboardTypeTool: AgentTool<KeyboardTypeParams>;
interface KeyboardShortcutParams {
    keys: string[];
}
export declare const keyboardShortcutTool: AgentTool<KeyboardShortcutParams>;
export {};
//# sourceMappingURL=keyboard.d.ts.map