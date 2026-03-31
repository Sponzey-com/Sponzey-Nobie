import { homedir } from "node:os"

export interface LLMProviderConfig {
  anthropic?: {
    apiKeys: string[]
  }
  openai?: {
    apiKeys: string[]
    baseUrl?: string
    auth?: {
      mode?: "api_key" | "chatgpt_oauth"
      codexAuthFilePath?: string
      clientId?: string
    }
  }
  gemini?: {
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

export interface ProfileConfig {
  profileName: string
  displayName: string
  language: string
  timezone: string
  workspace: string
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

export interface MqttConfig {
  enabled: boolean
  host: string
  port: number
  username: string
  password: string
  allowAnonymous: boolean
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
    provider: "openai" | "ollama" | "voyage"
    model: string
    apiKey?: string
    baseUrl?: string
  }
  searchMode?: "fts" | "vector" | "hybrid"
  sessionRetentionDays: number
  indexedPaths?: string[]
  excludePatterns?: string[]
}

export interface OrchestrationConfig {
  maxDelegationTurns: number
}

export interface McpServerConfig {
  enabled?: boolean
  transport?: "stdio" | "http"
  command?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  url?: string
  required?: boolean
  startupTimeoutSec?: number
  toolTimeoutSec?: number
  enabledTools?: string[]
  disabledTools?: string[]
}

export interface McpConfig {
  servers?: Record<string, McpServerConfig>
}

export interface SkillConfigItem {
  id: string
  label: string
  description: string
  source: "local" | "builtin"
  path?: string
  enabled: boolean
  required?: boolean
}

export interface SkillsConfig {
  items: SkillConfigItem[]
}

export interface NobieConfig {
  profile: ProfileConfig
  llm: {
    defaultProvider: string
    defaultModel: string
    providers: LLMProviderConfig
  }
  security: SecurityConfig
  telegram?: TelegramConfig
  webui: WebuiConfig
  scheduler: SchedulerConfig
  mqtt: MqttConfig
  search: SearchConfig
  memory: MemoryConfig
  orchestration: OrchestrationConfig
  mcp?: McpConfig
  skills?: SkillsConfig
}

export type WizbyConfig = NobieConfig
export type HowieConfig = NobieConfig

export const DEFAULT_CONFIG: NobieConfig = {
  profile: {
    profileName: "",
    displayName: "",
    language: "ko",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    workspace: homedir(),
  },
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
    auth: {
      enabled: false,
    },
  },
  scheduler: {
    enabled: true,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  },
  mqtt: {
    enabled: false,
    host: "0.0.0.0",
    port: 1883,
    username: "",
    password: "",
    allowAnonymous: false,
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
  orchestration: {
    maxDelegationTurns: 5,
  },
  mcp: {
    servers: {},
  },
  skills: {
    items: [],
  },
}
