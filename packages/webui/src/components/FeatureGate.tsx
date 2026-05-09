import * as React from "react"
import { DisabledPanel } from "./DisabledPanel"
import { ErrorState } from "./ErrorState"
import { PlannedState } from "./PlannedState"
import type { FeatureCapability } from "../contracts/capabilities"
import { TOPOLOGY_WORKSPACE_FEATURE_FALLBACK_COPY } from "../lib/topology-workspace-copy"
import { useUiI18n } from "../lib/ui-i18n"
import { useCapability } from "../stores/capabilities"

const FEATURE_GATE_FALLBACKS: Record<string, FeatureCapability> = {
  enterprise_topology_builder_ui: {
    key: "enterprise_topology_builder_ui",
    label: "Topology Workspace",
    area: "gateway",
    status: "disabled",
    implemented: true,
    enabled: false,
    reason: TOPOLOGY_WORKSPACE_FEATURE_FALLBACK_COPY.disabledReasonKo,
  },
}

export function FeatureGate({
  capabilityKey,
  title,
  children,
}: {
  capabilityKey: string
  title?: string
  children: React.ReactNode
}) {
  const capability = useCapability(capabilityKey) ?? FEATURE_GATE_FALLBACKS[capabilityKey]
  const { displayText, text } = useUiI18n()

  if (!capability || capability.status === "ready") {
    return <>{children}</>
  }

  if (capability.status === "planned") {
    return (
      <PlannedState
        title={title ?? capability.label}
        description={displayText(capability.reason ?? text("이 기능은 아직 구현 전 단계입니다.", "This feature is not implemented yet."))}
      />
    )
  }

  if (capability.status === "error") {
    return (
      <ErrorState
        title={title ?? capability.label}
        description={displayText(capability.reason ?? text("현재 오류 상태입니다.", "This feature is currently in an error state."))}
      />
    )
  }

  return (
    <DisabledPanel
      title={title ?? capability.label}
      reason={displayText(capability.reason ?? text("현재 사용할 수 없는 기능입니다.", "This feature is not available right now."))}
    />
  )
}
