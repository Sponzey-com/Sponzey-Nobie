import type { AIBackendCard, RoutingProfile } from "./ai"
import type { CapabilityStatus } from "./capabilities"

export type SetupStepId =
  | "welcome"
  | "personal"
  | "ai_backends"
  | "ai_routing"
  | "mcp"
  | "skills"
  | "security"
  | "channels"
  | "remote_access"
  | "review"
  | "done"

export interface SetupState {
  version: 1
  completed: boolean
  currentStep: SetupStepId
  completedAt?: number
  skipped: {
    telegram: boolean
    remoteAccess: boolean
  }
}

export interface SetupPersonalDraft {
  profileName: string
  displayName: string
  language: string
  timezone: string
  workspace: string
}

export interface SetupMcpServerDraft {
  id: string
  name: string
  transport: "stdio" | "http"
  command: string
  argsText: string
  cwd: string
  url: string
  required: boolean
  enabled: boolean
  status: CapabilityStatus
  reason?: string
  tools: string[]
}

export interface SetupSkillDraftItem {
  id: string
  label: string
  description: string
  source: "local" | "builtin"
  path: string
  enabled: boolean
  required: boolean
  status: CapabilityStatus
  reason?: string
}

export interface SetupSecurityDraft {
  approvalMode: "always" | "on-miss" | "off"
  approvalTimeout: number
  approvalTimeoutFallback: "deny" | "allow"
  maxDelegationTurns: number
}

export interface SetupChannelDraft {
  telegramEnabled: boolean
  botToken: string
  allowedUserIds: string
  allowedGroupIds: string
  slackEnabled: boolean
  slackBotToken: string
  slackAppToken: string
  slackAllowedUserIds: string
  slackAllowedChannelIds: string
}

export interface SetupRemoteAccessDraft {
  authEnabled: boolean
  authToken: string
  host: string
  port: number
}

export interface SetupMqttDraft {
  enabled: boolean
  host: string
  port: number
  username: string
  password: string
}

export interface SetupDraft {
  personal: SetupPersonalDraft
  aiBackends: AIBackendCard[]
  routingProfiles: RoutingProfile[]
  mcp: {
    servers: SetupMcpServerDraft[]
  }
  skills: {
    items: SetupSkillDraftItem[]
  }
  security: SetupSecurityDraft
  channels: SetupChannelDraft
  mqtt: SetupMqttDraft
  remoteAccess: SetupRemoteAccessDraft
}

export interface SetupStepMeta {
  id: SetupStepId
  label: string
  description: string
  status: CapabilityStatus
  reason?: string
  required: boolean
  highlights: string[]
  completed: boolean
  locked: boolean
  lockReason?: string
}
