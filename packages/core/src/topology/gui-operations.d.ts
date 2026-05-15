import type { EnterpriseEntityRef, EnterpriseRelationType, EnterpriseTimestamp, EnterpriseTopology, EnterpriseEntityStatus, FailurePolicy, NodeTemplateRef, NodeType, RecoveryPolicy } from "../contracts/enterprise-topology.js";
import { type TopologyValidationResult } from "./validator.js";
export declare const ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION: 1;
export type EnterpriseTopologyGuiDraftSchemaVersion = typeof ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION;
export type EnterpriseTopologyGuiOperationScope = "structural" | "layout";
export type EnterpriseTopologyGuiOperationKind = "createNode" | "updateNode" | "moveNode" | "deleteNode" | "createRelation" | "updateRelation" | "deleteRelation";
export type EnterpriseTopologyGuiCommandKind = EnterpriseTopologyGuiOperationKind | "undo" | "redo";
export interface EnterpriseTopologyGuiPosition {
    x: number;
    y: number;
}
export interface EnterpriseTopologyGuiNodeLayout extends EnterpriseTopologyGuiPosition {
    collapsed?: boolean;
}
export interface EnterpriseTopologyGuiLayout {
    nodes: Record<string, EnterpriseTopologyGuiNodeLayout>;
    viewport?: {
        x: number;
        y: number;
        zoom: number;
    };
}
export interface EnterpriseTopologyGuiOperationBase {
    schemaVersion: EnterpriseTopologyGuiDraftSchemaVersion;
    operationId: string;
    op: EnterpriseTopologyGuiOperationKind;
    at: EnterpriseTimestamp;
    actor?: string;
    label?: string;
}
export interface EnterpriseTopologyGuiCreateNodeOperation extends EnterpriseTopologyGuiOperationBase {
    op: "createNode";
    nodeId: string;
    name?: string;
    nodeType?: NodeType;
    position?: EnterpriseTopologyGuiPosition;
    templateId?: string;
}
export interface EnterpriseTopologyGuiUpdateNodePatch {
    name?: string;
    displayName?: string;
    description?: string;
    nodeType?: NodeType;
    status?: EnterpriseEntityStatus;
    tags?: string[];
    children?: string[];
    template?: NodeTemplateRef;
    allowedToolIds?: string[];
    allowedSystemIds?: string[];
    owner?: EnterpriseEntityRef<"position" | "org_unit" | "person" | "enterprise_system">;
    failurePolicy?: FailurePolicy;
    recoveryPolicy?: RecoveryPolicy;
}
export interface EnterpriseTopologyGuiUpdateNodeOperation extends EnterpriseTopologyGuiOperationBase {
    op: "updateNode";
    nodeId: string;
    patch: EnterpriseTopologyGuiUpdateNodePatch;
}
export interface EnterpriseTopologyGuiMoveNodeOperation extends EnterpriseTopologyGuiOperationBase {
    op: "moveNode";
    nodeId: string;
    position: EnterpriseTopologyGuiPosition;
    collapsed?: boolean;
}
export interface EnterpriseTopologyGuiDeleteNodeOperation extends EnterpriseTopologyGuiOperationBase {
    op: "deleteNode";
    nodeId: string;
}
export interface EnterpriseTopologyGuiCreateRelationOperation extends EnterpriseTopologyGuiOperationBase {
    op: "createRelation";
    relationId: string;
    relationType: EnterpriseRelationType;
    from: EnterpriseEntityRef;
    to: EnterpriseEntityRef;
    name?: string;
    label?: string;
}
export interface EnterpriseTopologyGuiUpdateRelationPatch {
    relationType?: EnterpriseRelationType;
    from?: EnterpriseEntityRef;
    to?: EnterpriseEntityRef;
    name?: string;
    label?: string;
    status?: EnterpriseEntityStatus;
}
export interface EnterpriseTopologyGuiUpdateRelationOperation extends EnterpriseTopologyGuiOperationBase {
    op: "updateRelation";
    relationId: string;
    patch: EnterpriseTopologyGuiUpdateRelationPatch;
}
export interface EnterpriseTopologyGuiDeleteRelationOperation extends EnterpriseTopologyGuiOperationBase {
    op: "deleteRelation";
    relationId: string;
}
export type EnterpriseTopologyGuiOperation = EnterpriseTopologyGuiCreateNodeOperation | EnterpriseTopologyGuiUpdateNodeOperation | EnterpriseTopologyGuiMoveNodeOperation | EnterpriseTopologyGuiDeleteNodeOperation | EnterpriseTopologyGuiCreateRelationOperation | EnterpriseTopologyGuiUpdateRelationOperation | EnterpriseTopologyGuiDeleteRelationOperation;
export interface EnterpriseTopologyGuiUndoCommand {
    schemaVersion: EnterpriseTopologyGuiDraftSchemaVersion;
    operationId: string;
    op: "undo";
    at: EnterpriseTimestamp;
    actor?: string;
}
export interface EnterpriseTopologyGuiRedoCommand {
    schemaVersion: EnterpriseTopologyGuiDraftSchemaVersion;
    operationId: string;
    op: "redo";
    at: EnterpriseTimestamp;
    actor?: string;
}
export type EnterpriseTopologyGuiCommand = EnterpriseTopologyGuiOperation | EnterpriseTopologyGuiUndoCommand | EnterpriseTopologyGuiRedoCommand;
export type EnterpriseTopologyQuickFixId = "set_start_node" | "add_child_task" | "add_approval_step" | "connect_selected_nodes" | "add_tool_permission" | "add_fallback_path" | "set_output_preset";
export interface EnterpriseTopologyQuickFixOperationPreview {
    operationId: string;
    op: EnterpriseTopologyGuiOperationKind;
    targetId: string;
    summary: string;
}
export interface EnterpriseTopologyQuickFixOperationPlan {
    quickFixId: EnterpriseTopologyQuickFixId;
    label: string;
    operations: EnterpriseTopologyGuiOperation[];
    preview: EnterpriseTopologyQuickFixOperationPreview[];
}
export interface EnterpriseTopologyGuiPendingDeletes {
    nodeIds: string[];
    relationIds: string[];
}
export interface EnterpriseTopologyGuiDraft {
    schemaVersion: EnterpriseTopologyGuiDraftSchemaVersion;
    draftId: string;
    topologyId: string;
    baseTopology: EnterpriseTopology;
    baseLayout: EnterpriseTopologyGuiLayout;
    topology: EnterpriseTopology;
    layout: EnterpriseTopologyGuiLayout;
    operationLog: EnterpriseTopologyGuiOperation[];
    redoStack: EnterpriseTopologyGuiOperation[];
    pendingDeletes: EnterpriseTopologyGuiPendingDeletes;
    validation: TopologyValidationResult;
    revision: number;
    structuralRevision: number;
    layoutRevision: number;
    createdAt: EnterpriseTimestamp;
    updatedAt: EnterpriseTimestamp;
}
export interface CreateEnterpriseTopologyGuiDraftInput {
    topology: EnterpriseTopology;
    draftId?: string;
    layout?: EnterpriseTopologyGuiLayout;
    now?: EnterpriseTimestamp;
}
export interface ApplyEnterpriseTopologyGuiCommandsResult {
    draft: EnterpriseTopologyGuiDraft;
    applied: EnterpriseTopologyGuiCommand[];
    structuralChanged: boolean;
    layoutChanged: boolean;
}
export type EnterpriseTopologyGuiOperationIssueCode = "invalid_gui_operation_payload" | "duplicate_node" | "node_not_found" | "duplicate_relation" | "relation_not_found" | "empty_undo_stack" | "empty_redo_stack";
export interface EnterpriseTopologyGuiOperationIssue {
    path: string;
    reasonCode: EnterpriseTopologyGuiOperationIssueCode;
    message: string;
}
export declare class EnterpriseTopologyGuiOperationError extends Error {
    readonly issue: EnterpriseTopologyGuiOperationIssue;
    constructor(issue: EnterpriseTopologyGuiOperationIssue);
}
export declare function enterpriseTopologyGuiOperationScope(operation: EnterpriseTopologyGuiCommand): EnterpriseTopologyGuiOperationScope;
export declare function createEnterpriseTopologyGuiDraft(input: CreateEnterpriseTopologyGuiDraftInput): EnterpriseTopologyGuiDraft;
export declare function applyEnterpriseTopologyGuiCommands(draft: EnterpriseTopologyGuiDraft, commands: EnterpriseTopologyGuiCommand[], options?: {
    now?: EnterpriseTimestamp;
}): ApplyEnterpriseTopologyGuiCommandsResult;
export declare function previewEnterpriseTopologyGuiOperation(operation: EnterpriseTopologyGuiOperation): EnterpriseTopologyQuickFixOperationPreview;
export declare function buildEnterpriseTopologyQuickFixOperationPlan(input: {
    quickFixId: EnterpriseTopologyQuickFixId;
    label: string;
    operations: EnterpriseTopologyGuiOperation[];
}): EnterpriseTopologyQuickFixOperationPlan;
export declare function createGuiDraftOperationId(prefix: string, at?: EnterpriseTimestamp): string;
export declare function isEnterpriseTopologyGuiOperationKind(value: string): value is EnterpriseTopologyGuiOperationKind;
export declare function isEnterpriseTopologyGuiCommandKind(value: string): value is EnterpriseTopologyGuiCommandKind;
export declare function isEnterpriseRelationType(value: string): value is EnterpriseRelationType;
//# sourceMappingURL=gui-operations.d.ts.map