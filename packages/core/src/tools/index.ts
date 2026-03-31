export { toolDispatcher, ToolDispatcher } from "./dispatcher.js"
export type { AgentTool, AnyTool, ToolContext, ToolResult, RiskLevel } from "./types.js"

export { fileReadTool, fileWriteTool, fileListTool, fileDeleteTool, filePatchTool } from "./builtin/file.js"
export { shellExecTool } from "./builtin/shell.js"
export { fileSearchTool } from "./builtin/file-search.js"
export { webSearchTool } from "./builtin/web-search.js"
export { webFetchTool } from "./builtin/web-fetch.js"
export { processListTool, processKillTool } from "./builtin/process.js"
export { appLaunchTool, appListTool } from "./builtin/app.js"
export { memoryStoreTool, memorySearchTool, fileSemanticSearchTool } from "./builtin/memory.js"
export { screenCaptureTool, screenFindTextTool } from "./builtin/ui/screen.js"
export { mouseMoveTool, mouseClickTool } from "./builtin/ui/mouse.js"
export { keyboardTypeTool, keyboardShortcutTool } from "./builtin/ui/keyboard.js"
export { clipboardReadTool, clipboardWriteTool } from "./builtin/ui/clipboard.js"
export { windowListTool, windowFocusTool } from "./builtin/ui/window.js"
export { yeonjangCameraListTool, yeonjangCameraCaptureTool } from "./builtin/yeonjang.js"
export { telegramSendFileTool } from "./builtin/telegram-send.js"

import { toolDispatcher } from "./dispatcher.js"
import { fileReadTool, fileWriteTool, fileListTool, fileDeleteTool, filePatchTool } from "./builtin/file.js"
import { shellExecTool } from "./builtin/shell.js"
import { fileSearchTool } from "./builtin/file-search.js"
import { webSearchTool } from "./builtin/web-search.js"
import { webFetchTool } from "./builtin/web-fetch.js"
import { processListTool, processKillTool } from "./builtin/process.js"
import { appLaunchTool, appListTool } from "./builtin/app.js"
import { memoryStoreTool, memorySearchTool, fileSemanticSearchTool } from "./builtin/memory.js"
import { screenCaptureTool, screenFindTextTool } from "./builtin/ui/screen.js"
import { mouseMoveTool, mouseClickTool } from "./builtin/ui/mouse.js"
import { keyboardTypeTool, keyboardShortcutTool } from "./builtin/ui/keyboard.js"
import { clipboardReadTool, clipboardWriteTool } from "./builtin/ui/clipboard.js"
import { windowListTool, windowFocusTool } from "./builtin/ui/window.js"
import { yeonjangCameraListTool, yeonjangCameraCaptureTool } from "./builtin/yeonjang.js"
import { telegramSendFileTool } from "./builtin/telegram-send.js"

export function registerBuiltinTools(): void {
  toolDispatcher.registerAll([
    // File tools
    fileReadTool,
    fileWriteTool,
    fileListTool,
    fileDeleteTool,
    filePatchTool,
    // Shell
    shellExecTool,
    // Search
    fileSearchTool,
    webSearchTool,
    webFetchTool,
    // Process / App
    processListTool,
    processKillTool,
    appLaunchTool,
    appListTool,
    // Memory
    memoryStoreTool,
    memorySearchTool,
    fileSemanticSearchTool,
    // UI Automation
    screenCaptureTool,
    screenFindTextTool,
    mouseMoveTool,
    mouseClickTool,
    keyboardTypeTool,
    keyboardShortcutTool,
    clipboardReadTool,
    clipboardWriteTool,
    windowListTool,
    windowFocusTool,
    // Yeonjang extension
    yeonjangCameraListTool,
    yeonjangCameraCaptureTool,
    // Channel delivery
    telegramSendFileTool,
  ])
}
