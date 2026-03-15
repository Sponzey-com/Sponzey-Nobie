export interface LLMProviderConfig {
  anthropic?: {
    apiKeys: string[]
  }
  openai?: {
    apiKeys: string[]
    baseUrl?: string
  }
  ollama?: {
    baseUrl: string
  }
  openrouter?: {
    apiKeys: string[]
  }
}

export interface SecurityConfig {
  allowedPaths: string[]
  approvalMode: "always" | "on-miss" | "off"
  approvalTimeout: number
  approvalTimeoutFallback: "allow" | "deny"
  allowedCommands: string[]
}

export interface TelegramConfig {
  enabled: boolean
  botToken: string
  allowedUserIds: number[]
  allowedGroupIds: number[]
}

export interface WebuiConfig {
  enabled: boolean
  port: number
  host: string
  auth: {
    enabled: boolean
    token?: string
  }
}

export interface SchedulerConfig {
  enabled: boolean
  timezone: string
}

export interface SearchConfig {
  web?: {
    provider: "brave" | "tavily" | "duckduckgo"
    apiKey?: string
    maxResults: number
  }
  files?: {
    indexedPaths: string[]
    excludePatterns: string[]
  }
}

export interface MemoryConfig {
  embedding?: {
    provider: "openai" | "ollama"
    model: string
    apiKey?: string
    baseUrl?: string
  }
  sessionRetentionDays: number
}

export interface SidekickConfig {
  llm: {
    defaultProvider: string
    defaultModel: string
    providers: LLMProviderConfig
  }
  security: SecurityConfig
  telegram?: TelegramConfig
  webui: WebuiConfig
  scheduler: SchedulerConfig
  search: SearchConfig
  memory: MemoryConfig
}

export const DEFAULT_CONFIG: SidekickConfig = {
  llm: {
    defaultProvider: "anthropic",
    defaultModel: "claude-3-5-haiku-20241022",
    providers: {},
  },
  security: {
    allowedPaths: [],
    approvalMode: "on-miss",
    approvalTimeout: 60,
    approvalTimeoutFallback: "deny",
    allowedCommands: [],
  },
  webui: {
    enabled: true,
    port: 18888,
    host: "127.0.0.1",
    auth: { enabled: false },
  },
  scheduler: {
    enabled: true,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  },
  search: {
    web: {
      provider: "duckduckgo",
      maxResults: 5,
    },
  },
  memory: {
    sessionRetentionDays: 30,
  },
}
