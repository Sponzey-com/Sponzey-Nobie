// Config
export { loadConfig, loadEnv, getConfig, reloadConfig, PATHS } from "./config/index.js"
export type { SidekickConfig, SecurityConfig, TelegramConfig } from "./config/index.js"

// Logger
export { createLogger, logger } from "./logger/index.js"
export type { Logger } from "./logger/index.js"

// Events
export { eventBus } from "./events/index.js"
export type { SidekickEvents } from "./events/index.js"

// DB
export {
  getDb,
  closeDb,
  insertSession,
  getSession,
  insertMessage,
  getMessages,
  insertAuditLog,
} from "./db/index.js"

// LLM
export { getProvider, getDefaultModel } from "./llm/index.js"
export type { LLMProvider, LLMChunk, Message, ToolDefinition, ChatParams } from "./llm/index.js"

// Tools
export { toolDispatcher, ToolDispatcher, registerBuiltinTools } from "./tools/index.js"
export type { AgentTool, AnyTool, ToolContext, ToolResult, RiskLevel } from "./tools/index.js"

// Agent
export { runAgent } from "./agent/index.js"
export type { AgentChunk, RunAgentParams } from "./agent/index.js"

// Channels
export { startChannels, TelegramChannel } from "./channels/index.js"

// Bootstrap: configure defaults and register built-in tools
import { loadConfig as _loadConfig } from "./config/index.js"
import { getDb as _getDb } from "./db/index.js"
import { registerBuiltinTools as _registerBuiltinTools } from "./tools/index.js"

export function bootstrap(): void {
  _loadConfig()
  _getDb()
  _registerBuiltinTools()
}
