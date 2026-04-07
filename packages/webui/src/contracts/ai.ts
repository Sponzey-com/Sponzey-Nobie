import type { CapabilityStatus } from "./capabilities"

export type AIBackendKind = "provider"
export type AIProviderType = "openai" | "ollama" | "llama" | "anthropic" | "gemini" | "custom"
export type AIAuthMode = "api_key" | "chatgpt_oauth"
export type AIBackendCredentialKey = "apiKey" | "username" | "password" | "oauthAuthFilePath"

export interface AIBackendCredentials {
  apiKey?: string
  username?: string
  password?: string
  oauthAuthFilePath?: string
}

export interface AIProviderCredentialField {
  key: AIBackendCredentialKey
  label: string
  inputType: "text" | "password"
  placeholder: string
  required: boolean
}

export interface AIBackendCard {
  id: string
  label: string
  kind: AIBackendKind
  providerType: AIProviderType
  authMode: AIAuthMode
  credentials: AIBackendCredentials
  local: boolean
  enabled: boolean
  availableModels: string[]
  defaultModel: string
  status: CapabilityStatus
  summary: string
  tags: string[]
  reason?: string
  endpoint?: string
}

export interface NewAIBackendInput {
  label: string
  kind: AIBackendKind
  providerType: AIProviderType
  authMode: AIAuthMode
  credentials: AIBackendCredentials
  local: boolean
  availableModels: string[]
  defaultModel: string
  summary: string
  endpoint?: string
  tags: string[]
}

export type RoutingProfileId =
  | "default"
  | "general_chat"
  | "planning"
  | "coding"
  | "review"
  | "research"
  | "private_local"
  | "summarization"
  | "operations"

export interface RoutingProfile {
  id: RoutingProfileId
  label: string
  targets: string[]
}

export const BUILTIN_BACKEND_IDS = [
  "provider:openai",
  "provider:anthropic",
  "provider:gemini",
  "provider:ollama",
  "provider:llama_cpp",
] as const

export function isBuiltinBackendId(id: string): boolean {
  return (BUILTIN_BACKEND_IDS as readonly string[]).includes(id)
}

export const AI_PROVIDER_OPTIONS: Array<{ value: AIProviderType; label: string }> = [
  { value: "ollama", label: "Ollama" },
  { value: "llama", label: "llama" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "gemini", label: "Gemini" },
  { value: "custom", label: "Custom" },
]

export function getAIProviderLabel(providerType: AIProviderType): string {
  return AI_PROVIDER_OPTIONS.find((item) => item.value === providerType)?.label ?? providerType
}

export function isLocalProviderType(providerType: AIProviderType): boolean {
  return providerType === "ollama" || providerType === "llama"
}

export function getAIProviderEndpointPlaceholder(providerType: AIProviderType): string {
  switch (providerType) {
    case "ollama":
      return "http://127.0.0.1:11434/v1"
    case "llama":
      return "http://127.0.0.1:8080"
    case "openai":
      return "https://api.openai.com/v1"
    case "anthropic":
      return "https://api.anthropic.com"
    case "gemini":
      return "https://generativelanguage.googleapis.com"
    case "custom":
      return "https://your-endpoint.example.com"
  }
}

export function getAIProviderDefaultEndpoint(providerType: AIProviderType): string {
  switch (providerType) {
    case "openai":
      return "https://api.openai.com/v1"
    case "ollama":
      return "http://127.0.0.1:11434/v1"
    case "anthropic":
      return "https://api.anthropic.com"
    case "gemini":
      return "https://generativelanguage.googleapis.com"
    case "llama":
    case "custom":
      return ""
  }
}

export function getAIProviderCredentialFields(providerType: AIProviderType, authMode: AIAuthMode = "api_key"): AIProviderCredentialField[] {
  switch (providerType) {
    case "openai":
      if (authMode === "chatgpt_oauth") {
        return [{ key: "oauthAuthFilePath", label: "Auth File Path", inputType: "text", placeholder: "~/.codex/auth.json", required: false }]
      }
      return [{ key: "apiKey", label: "API Key", inputType: "password", placeholder: "sk-...", required: true }]
    case "anthropic":
      return [{ key: "apiKey", label: "API Key", inputType: "password", placeholder: "sk-ant-...", required: true }]
    case "gemini":
      return [{ key: "apiKey", label: "API Key", inputType: "password", placeholder: "AIza...", required: true }]
    case "custom":
      return [
        { key: "apiKey", label: "API Key", inputType: "password", placeholder: "optional-api-key", required: false },
        { key: "username", label: "Username", inputType: "text", placeholder: "optional-username", required: false },
        { key: "password", label: "Password", inputType: "password", placeholder: "optional-password", required: false },
      ]
    case "ollama":
    case "llama":
      return []
  }
}

export function hasRequiredProviderCredentials(
  providerType: AIProviderType,
  credentials: AIBackendCredentials,
  authMode: AIAuthMode = "api_key",
): boolean {
  if (providerType === "openai" && authMode === "chatgpt_oauth") {
    return true
  }
  return getAIProviderCredentialFields(providerType, authMode)
    .filter((field) => field.required)
    .every((field) => (credentials[field.key] ?? "").trim().length > 0)
}
