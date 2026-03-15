export { toolDispatcher, ToolDispatcher } from "./dispatcher.js"
export type { AgentTool, AnyTool, ToolContext, ToolResult, RiskLevel } from "./types.js"

export { fileReadTool, fileWriteTool, fileListTool, fileDeleteTool, filePatchTool } from "./builtin/file.js"
export { shellExecTool } from "./builtin/shell.js"
export { fileSearchTool } from "./builtin/file-search.js"
export { webSearchTool } from "./builtin/web-search.js"

import { toolDispatcher } from "./dispatcher.js"
import { fileReadTool, fileWriteTool, fileListTool, fileDeleteTool, filePatchTool } from "./builtin/file.js"
import { shellExecTool } from "./builtin/shell.js"
import { fileSearchTool } from "./builtin/file-search.js"
import { webSearchTool } from "./builtin/web-search.js"

export function registerBuiltinTools(): void {
  toolDispatcher.registerAll([
    fileReadTool,
    fileWriteTool,
    fileListTool,
    fileDeleteTool,
    filePatchTool,
    shellExecTool,
    fileSearchTool,
    webSearchTool,
  ])
}
