/**
 * Keyboard control tools.
 * Requires Yeonjang for execution.
 */
import type { AgentTool } from "../../types.js";
interface KeyboardTypeParams {
    text: string;
    extensionId?: string;
}
interface KeyboardShortcutParams {
    keys: string[];
    extensionId?: string;
}
interface KeyboardActionParams {
    action: "type_text" | "shortcut" | "key_press" | "key_down" | "key_up";
    text?: string;
    key?: string;
    modifiers?: string[];
    extensionId?: string;
}
export declare const keyboardTypeTool: AgentTool<KeyboardTypeParams>;
export declare const keyboardShortcutTool: AgentTool<KeyboardShortcutParams>;
export declare const keyboardActionTool: AgentTool<KeyboardActionParams>;
export {};
//# sourceMappingURL=keyboard.d.ts.map