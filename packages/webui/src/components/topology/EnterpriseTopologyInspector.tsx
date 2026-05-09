import * as React from "react"
import type { NodeContract } from "../../contracts/enterprise-topology"
import type { AgentTopologyProjection } from "../../contracts/topology"
import type { TopologyTemplateCatalog } from "../../contracts/topology-templates"
import type { EnterpriseTopologyCanvasNodeData } from "./EnterpriseTopologyCanvas"
import {
  TopologyWorkspaceInspector,
  type TopologyWorkspaceExecutorMapping,
} from "./TopologyWorkspaceInspector"

export {
  TopologyWorkspaceInspector,
  TopologyWorkspaceExecutorPicker,
  TOPOLOGY_WORKSPACE_EXECUTOR_OPTIONS,
  applyTopologyWorkspaceExecutorMappingToNode,
  buildTopologyWorkspaceExecutorMapping,
  buildTopologyWorkspaceRuntimeExecutorResourceOptions,
  readTopologyWorkspaceExecutorMappingFromNode,
  type TopologyWorkspaceExecutorKind,
  type TopologyWorkspaceExecutorMapping,
  type TopologyWorkspaceExecutorOption,
  type TopologyWorkspaceRuntimeExecutorResourceOption,
} from "./TopologyWorkspaceInspector"

export function EnterpriseTopologyInspector({
  selectedData,
  templateCatalog,
  selectedNodeContract,
  executorMapping,
  runtimeResources,
  onExecutorMappingChange,
}: {
  selectedData?: EnterpriseTopologyCanvasNodeData | null
  templateCatalog?: TopologyTemplateCatalog | null
  selectedNodeContract?: NodeContract | null
  executorMapping?: TopologyWorkspaceExecutorMapping | null
  runtimeResources?: AgentTopologyProjection | null
  onExecutorMappingChange?: (nodeId: string, mapping: TopologyWorkspaceExecutorMapping) => void
}) {
  return (
    <TopologyWorkspaceInspector
      selectedData={selectedData}
      templateCatalog={templateCatalog}
      selectedNodeContract={selectedNodeContract}
      executorMapping={executorMapping}
      runtimeResources={runtimeResources}
      onExecutorMappingChange={onExecutorMappingChange}
    />
  )
}
