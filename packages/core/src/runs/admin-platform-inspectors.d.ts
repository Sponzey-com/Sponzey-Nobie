import { type MqttBrokerSnapshot, type MqttExchangeLogEntry } from "../mqtt/broker.js";
import { type MigrationVersionStatus } from "../config/operations.js";
import { type DbMessageLedgerEvent } from "../db/index.js";
import { type MigrationLockRow, type MigrationVerificationReport } from "../db/migration-safety.js";
import { type ControlTimeline } from "../control-plane/timeline.js";
export interface AdminPlatformInspectorInput {
    timeline: ControlTimeline;
    ledgerEvents: DbMessageLedgerEvent[];
    limit?: number;
    filters?: AdminDiagnosticExportFilters;
}
export interface AdminDiagnosticExportFilters {
    runId?: string;
    requestGroupId?: string;
    sessionKey?: string;
    channel?: string;
}
export interface AdminYeonjangNodeView {
    extensionId: string;
    clientId: string | null;
    displayName: string | null;
    state: string | null;
    message: string | null;
    version: string | null;
    protocolVersion: string | null;
    capabilityHash: string | null;
    methodCount: number;
    platform: string | null;
    transport: string[];
    lastSeenAt: number | null;
    stale: boolean;
    heartbeatCount: number;
    reconnectAttempts: number;
    capabilities: string[];
}
export interface AdminYeonjangInspector {
    summary: {
        brokerRunning: boolean;
        enabled: boolean;
        connectedClients: number;
        nodes: number;
        onlineNodes: number;
        heartbeats: number;
        reconnectAttempts: number;
        disconnects: number;
    };
    broker: MqttBrokerSnapshot;
    nodes: AdminYeonjangNodeView[];
    timelineLinks: Array<{
        at: number;
        eventType: string;
        component: string;
        summary: string;
        extensionId: string | null;
        state: string | null;
        reconnectAttempts: number | null;
    }>;
    exchangeLog: Array<Omit<MqttExchangeLogEntry, "payload"> & {
        payloadPreview: unknown;
    }>;
    degradedReasons: string[];
}
export interface AdminDatabaseInspector {
    summary: {
        currentVersion: number;
        latestVersion: number;
        pendingMigrations: number;
        unknownAppliedVersions: number;
        migrationLockActive: boolean;
        integrityOk: boolean;
        backupSnapshots: number;
        migrationDiagnostics: number;
    };
    migrations: MigrationVersionStatus;
    lock: {
        active: MigrationLockRow | null;
        latest: MigrationLockRow | null;
    };
    integrity: MigrationVerificationReport | null;
    backups: {
        snapshots: Array<{
            id: string;
            createdAt: number;
            schemaVersion: number | null;
            latestSchemaVersion: number | null;
            fileCount: number;
            manifestFile: string;
        }>;
        degradedReasons: string[];
    };
    diagnostics: Array<{
        id: string;
        kind: string;
        summary: string;
        runId: string | null;
        requestGroupId: string | null;
        createdAt: number;
        detail: unknown;
    }>;
    degradedReasons: string[];
}
export interface AdminDiagnosticExportJob {
    id: string;
    status: "queued" | "running" | "succeeded" | "failed";
    progress: number;
    createdAt: number;
    updatedAt: number;
    filters: AdminDiagnosticExportFilters;
    includeTimeline: boolean;
    includeReport: boolean;
    bundlePath: string | null;
    bundleFile: string | null;
    bundleBytes: number | null;
    error: string | null;
}
export interface AdminDiagnosticExportStartInput extends AdminDiagnosticExportFilters {
    includeTimeline?: boolean;
    includeReport?: boolean;
    limit?: number;
}
export interface AdminPlatformInspectors {
    yeonjang: AdminYeonjangInspector;
    database: AdminDatabaseInspector;
    exports: {
        jobs: AdminDiagnosticExportJob[];
        defaults: {
            outputDirName: string;
            sanitized: true;
            backgroundJob: true;
        };
    };
}
export declare function buildAdminPlatformInspectors(input: AdminPlatformInspectorInput): AdminPlatformInspectors;
export declare function startAdminDiagnosticExport(input?: AdminDiagnosticExportStartInput): AdminDiagnosticExportJob;
export declare function getAdminDiagnosticExportJob(id: string): AdminDiagnosticExportJob | null;
export declare function listAdminDiagnosticExportJobs(): AdminDiagnosticExportJob[];
//# sourceMappingURL=admin-platform-inspectors.d.ts.map