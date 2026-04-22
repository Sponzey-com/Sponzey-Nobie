export type CapabilityStatus = "ready" | "disabled" | "planned" | "error"

export type CapabilityArea =
  | "setup"
  | "gateway"
  | "runs"
  | "chat"
  | "ai"
  | "security"
  | "telegram"
  | "slack"
  | "scheduler"
  | "plugins"
  | "memory"
  | "mcp"
  | "mqtt"

export interface FeatureCapability {
  key: string
  label: string
  area: CapabilityArea
  status: CapabilityStatus
  implemented: boolean
  enabled: boolean
  reason?: string
  dependsOn?: string[]
  metadata?: Record<string, unknown>
}

export interface CapabilityCounts {
  ready: number
  disabled: number
  planned: number
  error: number
}

export function countCapabilities(items: FeatureCapability[]): CapabilityCounts {
  return items.reduce<CapabilityCounts>(
    (acc, item) => {
      acc[item.status] += 1
      return acc
    },
    { ready: 0, disabled: 0, planned: 0, error: 0 },
  )
}
