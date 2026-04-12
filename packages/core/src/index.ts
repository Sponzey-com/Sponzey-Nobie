// Config
export { loadConfig, loadEnv, getConfig, reloadConfig, PATHS } from "./config/index.js"
export { generateAuthToken } from "./config/auth.js"
export type {
  NobieConfig,
  WizbyConfig,
  HowieConfig,
  SecurityConfig,
  TelegramConfig,
  MqttConfig,
  OrchestrationConfig,
  McpConfig,
  McpServerConfig,
} from "./config/index.js"

// Logger
export { createLogger, logger } from "./logger/index.js"
export type { Logger } from "./logger/index.js"

// Events
export { eventBus } from "./events/index.js"
export type { NobieEvents, WizbyEvents, HowieEvents } from "./events/index.js"

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

// Tools
export { toolDispatcher, ToolDispatcher, registerBuiltinTools } from "./tools/index.js"
export type { AgentTool, AnyTool, ToolContext, ToolResult, RiskLevel } from "./tools/index.js"

// Agent
export { runAgent } from "./agent/index.js"
export type { AgentChunk, RunAgentParams } from "./agent/index.js"
export { buildTaskIntakeSystemPrompt } from "./agent/intake-prompt.js"
export type {
  TaskIntakeActionType,
  TaskIntakeIntentCategory,
  TaskIntakeMessageMode,
  TaskIntakePriority,
  TaskIntakePromptOptions,
  TaskIntakeTaskProfile,
} from "./agent/intake-prompt.js"

// Instructions
export { discoverInstructionChain } from "./instructions/discovery.js"
export { loadMergedInstructions } from "./instructions/merge.js"
export type { InstructionChain, InstructionSource } from "./instructions/discovery.js"
export type { MergedInstructionBundle } from "./instructions/merge.js"

// Memory
export { storeMemory, storeMemorySync, searchMemory, searchMemorySync, recentMemories, buildMemoryContext } from "./memory/store.js"
export {
  loadNobieMd,
  initNobieMd,
  loadWizbyMd,
  initWizbyMd,
  loadHowieMd,
  initHowieMd,
  ensurePromptSourceFiles,
  loadFirstRunPromptSourceAssembly,
  loadPromptSourceRegistry,
  loadSystemPromptSourceAssembly,
  loadSystemPromptSources,
  detectPromptSourceSecretMarkers,
  isPromptSourceContentSafe,
} from "./memory/nobie-md.js"
export { fileIndexer, FileIndexer } from "./memory/file-indexer.js"
export { getEmbeddingProvider, NullEmbeddingProvider, OllamaEmbeddingProvider, VoyageEmbeddingProvider, OpenAIEmbeddingProvider } from "./memory/embedding.js"

// Plugins
export { pluginLoader, PluginLoader } from "./plugins/loader.js"
export type { NobiePlugin, WizbyPlugin, HowiePlugin, PluginContext, PluginMeta } from "./plugins/types.js"

// MCP
export { mcpRegistry } from "./mcp/registry.js"
export { McpStdioClient } from "./mcp/client.js"
export type { McpServerStatus, McpSummary, McpToolStatus } from "./mcp/registry.js"

// MQTT
export { startMqttBroker, stopMqttBroker, getMqttBrokerSnapshot } from "./mqtt/broker.js"
export type { MqttBrokerSnapshot } from "./mqtt/broker.js"

// Channels
export { startChannels, TelegramChannel, SlackChannel } from "./channels/index.js"

// Runs
export { startRootRun } from "./runs/start.js"
export type { StartRootRunParams, StartedRootRun } from "./runs/start.js"
export { buildIngressReceipt, resolveIngressStartParams, startIngressRun } from "./runs/ingress.js"
export type { IngressReceipt, IngressReceiptLanguage, ResolvedIngressStartParams, StartedIngressRun } from "./runs/ingress.js"

// Scheduler
export { runSchedule, runScheduleAndWait } from "./scheduler/index.js"

// API server
export { startServer, closeServer } from "./api/server.js"

// Bootstrap: configure defaults and register built-in tools
import { loadConfig as _loadConfig } from "./config/index.js"
import { getDb as _getDb, insertAuditLog as _insertAuditLog, upsertPromptSources as _upsertPromptSources } from "./db/index.js"
import { ensurePromptSourceFiles as _ensurePromptSourceFiles } from "./memory/nobie-md.js"
import { recoverActiveRunsOnStartup as _recoverActiveRunsOnStartup } from "./runs/store.js"
import { registerBuiltinTools as _registerBuiltinTools } from "./tools/index.js"
import { startServer as _startServer } from "./api/server.js"
import { mcpRegistry as _mcpRegistry } from "./mcp/registry.js"
import { startMqttBroker as _startMqttBroker, stopMqttBroker as _stopMqttBroker } from "./mqtt/broker.js"
import { startChannels as _startChannels } from "./channels/index.js"

export function bootstrap(): void {
  _loadConfig()
  _getDb()
  try {
    const promptSeed = _ensurePromptSourceFiles(process.cwd())
    _upsertPromptSources(promptSeed.registry.map(({ content: _content, ...metadata }) => metadata))
    _insertAuditLog({
      timestamp: Date.now(),
      session_id: null,
      source: "system",
      tool_name: "prompt_bootstrap",
      params: JSON.stringify({ promptsDir: promptSeed.promptsDir }),
      output: JSON.stringify({ created: promptSeed.created, existing: promptSeed.existing.length, sources: promptSeed.registry.length }),
      result: "success",
      duration_ms: null,
      approval_required: 0,
      approved_by: null,
    })
  } catch {
    try {
      _insertAuditLog({
        timestamp: Date.now(),
        session_id: null,
        source: "system",
        tool_name: "prompt_bootstrap",
        params: null,
        output: "Prompt bootstrap failed with a safe initialization error summary.",
        result: "failed",
        duration_ms: null,
        approval_required: 0,
        approved_by: null,
      })
    } catch {
      // Keep startup alive; prompt bootstrap failures are surfaced through diagnostics when DB is available.
    }
  }
  _registerBuiltinTools()
}

export async function bootstrapRuntime(): Promise<void> {
  bootstrap()
  _recoverActiveRunsOnStartup()
  await _mcpRegistry.loadFromConfig()
}

export async function bootstrapAsync(): Promise<void> {
  await bootstrapRuntime()
  await _startMqttBroker()
  await _startChannels()
  try {
    await _startServer()
  } catch (error) {
    await _stopMqttBroker()
    throw error
  }
}
