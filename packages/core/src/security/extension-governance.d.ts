import { type NobieConfig } from "../config/index.js";
import type { AnyTool } from "../tools/types.js";
export type ExtensionKind = "mcp_server" | "mcp_tool" | "skill" | "hook" | "yeonjang_tool" | "internal_tool" | "plugin";
export type ExtensionTrustLevel = "builtin" | "local" | "external" | "unknown";
export type ExtensionStatus = "ready" | "disabled" | "degraded" | "error" | "unknown";
export type ExtensionPermissionScope = "safe" | "moderate" | "dangerous" | "local" | "network" | "unknown";
export interface ExtensionTrustPolicy {
    trustLevel: ExtensionTrustLevel;
    requiresApproval: boolean;
    approved: boolean;
    userFacingRecommended: boolean;
    reason: string;
}
export interface ExtensionRegistryEntry {
    id: string;
    kind: ExtensionKind;
    label: string;
    version: string;
    checksum: string;
    permissionScope: ExtensionPermissionScope;
    timeoutMs: number;
    enabled: boolean;
    priority: number | null;
    status: ExtensionStatus;
    trustPolicy: ExtensionTrustPolicy;
    failureCount: number;
    degradedReason: string | null;
    sourcePath: string | null;
    rollbackAvailable: boolean;
    metadata: Record<string, unknown>;
}
export interface ExtensionRegistrySnapshot {
    kind: "nobie.extension.registry";
    version: 1;
    createdAt: string;
    checksum: string;
    totalCount: number;
    enabledCount: number;
    disabledCount: number;
    degradedCount: number;
    dangerousCount: number;
    entries: ExtensionRegistryEntry[];
}
export interface ExtensionFailureState {
    extensionId: string;
    failureCount: number;
    degraded: boolean;
    lastFailureAt: number;
    lastError: string;
    reason: string;
}
export interface ExtensionRollbackPoint {
    rollbackId: string;
    extensionId: string;
    sourcePath: string;
    checksum: string;
    contentBase64: string;
    createdAt: number;
}
export interface ExtensionActivationResult {
    ok: boolean;
    entry: ExtensionRegistryEntry;
    reasonCode: "activated" | "approval_required";
    userMessage: string;
}
export interface MinimalMcpToolStatus {
    name: string;
    registeredName: string;
    description: string;
}
export interface MinimalMcpServerStatus {
    name: string;
    enabled: boolean;
    ready: boolean;
    toolCount: number;
    registeredToolCount: number;
    error?: string;
    tools: MinimalMcpToolStatus[];
}
export declare function buildExtensionRegistrySnapshot(input?: {
    config?: NobieConfig;
    tools?: AnyTool[];
    mcpStatuses?: MinimalMcpServerStatus[];
    now?: Date;
}): ExtensionRegistrySnapshot;
export declare function extensionIdsForToolName(toolName: string): string[];
export declare function isToolExtensionSelectable(toolName: string): boolean;
export declare function getExtensionFailureState(extensionId: string): ExtensionFailureState | null;
export declare function listExtensionFailureStates(): ExtensionFailureState[];
export declare function resetExtensionFailureState(extensionId?: string): void;
export declare function recordExtensionRegistryChange(input: {
    action: string;
    extensionId: string;
    result: "success" | "failure" | "skipped";
    detail?: Record<string, unknown>;
}): void;
export declare function recordExtensionFailure(input: {
    extensionId: string;
    kind: ExtensionKind;
    error: unknown;
    runId?: string | null;
    requestGroupId?: string | null;
    degradeAfter?: number;
    detail?: Record<string, unknown>;
}): ExtensionFailureState;
export declare function recordExtensionToolFailure(input: {
    toolName: string;
    error: unknown;
    runId?: string | null;
    requestGroupId?: string | null;
    detail?: Record<string, unknown>;
}): ExtensionFailureState[];
export declare function runExtensionHookSafely<T>(input: {
    extensionId: string;
    hookName: string;
    timeoutMs?: number;
    runId?: string | null;
    requestGroupId?: string | null;
}, hook: () => Promise<T> | T): Promise<{
    ok: true;
    result: T;
} | {
    ok: false;
    error: string;
    state: ExtensionFailureState;
}>;
export declare function createExtensionRollbackPoint(input: {
    extensionId: string;
    sourcePath: string;
}): ExtensionRollbackPoint;
export declare function rollbackExtensionToPoint(extensionId: string): ExtensionRollbackPoint;
export declare function activateExtensionWithTrustPolicy(entry: ExtensionRegistryEntry, input?: {
    approved?: boolean;
}): ExtensionActivationResult;
//# sourceMappingURL=extension-governance.d.ts.map