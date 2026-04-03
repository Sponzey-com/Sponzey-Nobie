/**
 * 스폰지 노비 · Sponzey Nobie Plugin System — type definitions.
 */

import type { AnyTool } from "../tools/types.js"

/** Context passed to plugins during initialization */
export interface PluginContext {
  /** Register additional tools at startup */
  registerTools(tools: AnyTool[]): void
  /** Get app config value by key path (e.g. "ai.defaultModel") */
  getConfig<T = unknown>(keyPath: string): T | undefined
  /** Write a log message */
  log(level: "info" | "warn" | "error", message: string, data?: unknown): void
}

/** Metadata stored in the DB and returned by API */
export interface PluginMeta {
  id: string
  name: string
  version: string
  description: string | null
  entry_path: string
  enabled: number        // 0 | 1
  config: string         // JSON object
  installed_at: number
  updated_at: number
}

/** Interface that every plugin module must export as default */
export interface NobiePlugin {
  /** Unique name, kebab-case (e.g. "my-plugin") */
  name: string
  version: string
  description?: string

  /** Called once when the plugin is loaded. Register tools, start background tasks, etc. */
  initialize(ctx: PluginContext): Promise<void> | void

  /** Called when the plugin is disabled/unloaded. Clean up resources. */
  teardown?(): Promise<void> | void
}

export type WizbyPlugin = NobiePlugin
export type HowiePlugin = NobiePlugin
