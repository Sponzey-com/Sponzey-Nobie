/**
 * Clipboard tools - platform-specific implementation.
 */
import type { AgentTool } from "../../types.js";
export declare const clipboardReadTool: AgentTool<Record<string, never>>;
interface ClipboardWriteParams {
    text: string;
}
export declare const clipboardWriteTool: AgentTool<ClipboardWriteParams>;
export {};
//# sourceMappingURL=clipboard.d.ts.map