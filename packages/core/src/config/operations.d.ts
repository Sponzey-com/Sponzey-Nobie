export interface MigrationVersionStatus {
    databasePath: string;
    exists: boolean;
    currentVersion: number;
    latestVersion: number;
    appliedVersions: number[];
    pendingVersions: number[];
    unknownAppliedVersions: number[];
    upToDate: boolean;
}
export interface MigrationDryRunResult {
    status: MigrationVersionStatus;
    willApply: Array<{
        version: number;
        transaction: boolean;
    }>;
    warnings: string[];
    changesDatabase: false;
    userMessage: string;
}
export interface DatabaseBackupResult {
    id: string;
    kind: "backup" | "export" | "rollback";
    databasePath: string;
    backupPath: string;
    walPath?: string;
    shmPath?: string;
    checksum: string;
    createdAt: number;
}
export interface DatabaseImportResult {
    ok: true;
    importedPath: string;
    rollbackBackup: DatabaseBackupResult;
    status: MigrationVersionStatus;
}
export interface ConfigExportResult {
    id: string;
    configPath: string;
    exportPath: string;
    checksum: string;
    createdAt: number;
    masking: {
        secretsMasked: number;
        channelIdsMasked: false;
        userIdsMasked: false;
        policy: string;
    };
}
export interface ConfigurationOperationsSnapshot {
    database: MigrationVersionStatus;
    promptSources: {
        workDir: string;
        count: number;
        versions: Array<{
            sourceId: string;
            locale: "ko" | "en";
            version: string;
            checksum: string;
            path: string;
            enabled: boolean;
            required: boolean;
            usageScope: string;
        }>;
    };
    config: {
        configPath: string;
        exists: boolean;
        masked: Record<string, unknown>;
        maskingPolicy: ConfigExportResult["masking"]["policy"];
    };
}
export declare function getDatabaseMigrationStatus(dbPath?: string): MigrationVersionStatus;
export declare function dryRunDatabaseMigrations(dbPath?: string): MigrationDryRunResult;
export declare function createDatabaseBackup(kind?: DatabaseBackupResult["kind"], dbPath?: string): DatabaseBackupResult;
export declare function importDatabaseFromBackup(input: {
    backupPath: string;
    dbPath?: string;
}): DatabaseImportResult;
export declare function maskSecretsDeep(value: unknown): {
    value: unknown;
    maskedCount: number;
};
export declare function exportMaskedConfig(): ConfigExportResult;
export declare function recoverPromptSources(workDir?: string): import("../memory/nobie-md.js").PromptSourceSeedResult;
export declare function exportPromptSources(workDir?: string): import("../memory/nobie-md.js").PromptSourceExportResult;
export declare function importPromptSources(input: {
    workDir?: string;
    exportPath: string;
    overwrite?: boolean;
}): import("../memory/nobie-md.js").PromptSourceImportResult;
export declare function buildConfigurationOperationsSnapshot(workDir?: string): ConfigurationOperationsSnapshot;
export declare function replaceFileAtomically(sourcePath: string, targetPath: string): void;
//# sourceMappingURL=operations.d.ts.map