export type McpTransport = "stdio" | "http"

export interface McpToolStatus {
  name: string
  registeredName: string
  description: string
}

export interface McpServerStatus {
  name: string
  transport: McpTransport
  enabled: boolean
  required: boolean
  ready: boolean
  toolCount: number
  registeredToolCount: number
  command?: string
  url?: string
  error?: string
  tools: McpToolStatus[]
}

export interface McpSummary {
  serverCount: number
  readyCount: number
  toolCount: number
  requiredFailures: number
}

export interface McpServersResponse {
  servers: McpServerStatus[]
  summary: McpSummary
}
