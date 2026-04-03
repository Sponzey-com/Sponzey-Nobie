// Config
export { loadConfig, loadEnv, getConfig, reloadConfig, PATHS } from "./config/index.js";
export { generateAuthToken } from "./config/auth.js";
// Logger
export { createLogger, logger } from "./logger/index.js";
// Events
export { eventBus } from "./events/index.js";
// DB
export { getDb, closeDb, insertSession, getSession, insertMessage, getMessages, insertAuditLog, } from "./db/index.js";
// Tools
export { toolDispatcher, ToolDispatcher, registerBuiltinTools } from "./tools/index.js";
// Agent
export { runAgent } from "./agent/index.js";
export { buildTaskIntakeSystemPrompt } from "./agent/intake-prompt.js";
// Instructions
export { discoverInstructionChain } from "./instructions/discovery.js";
export { loadMergedInstructions } from "./instructions/merge.js";
// Memory
export { storeMemory, storeMemorySync, searchMemory, searchMemorySync, recentMemories, buildMemoryContext } from "./memory/store.js";
export { loadNobieMd, initNobieMd, loadWizbyMd, initWizbyMd, loadHowieMd, initHowieMd } from "./memory/nobie-md.js";
export { fileIndexer, FileIndexer } from "./memory/file-indexer.js";
export { getEmbeddingProvider, NullEmbeddingProvider, OllamaEmbeddingProvider, VoyageEmbeddingProvider, OpenAIEmbeddingProvider } from "./memory/embedding.js";
// Plugins
export { pluginLoader, PluginLoader } from "./plugins/loader.js";
// MCP
export { mcpRegistry } from "./mcp/registry.js";
export { McpStdioClient } from "./mcp/client.js";
// Channels
export { startChannels, TelegramChannel } from "./channels/index.js";
// Runs
export { startRootRun } from "./runs/start.js";
// API server
export { startServer, closeServer } from "./api/server.js";
// Bootstrap: configure defaults and register built-in tools
import { loadConfig as _loadConfig } from "./config/index.js";
import { getDb as _getDb } from "./db/index.js";
import { recoverActiveRunsOnStartup as _recoverActiveRunsOnStartup } from "./runs/store.js";
import { registerBuiltinTools as _registerBuiltinTools } from "./tools/index.js";
import { startServer as _startServer } from "./api/server.js";
import { mcpRegistry as _mcpRegistry } from "./mcp/registry.js";
export function bootstrap() {
    _loadConfig();
    _getDb();
    _registerBuiltinTools();
}
export async function bootstrapRuntime() {
    bootstrap();
    _recoverActiveRunsOnStartup();
    await _mcpRegistry.loadFromConfig();
}
export async function bootstrapAsync() {
    await bootstrapRuntime();
    await _startServer();
}
//# sourceMappingURL=index.js.map
