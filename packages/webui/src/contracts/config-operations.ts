export interface MigrationVersionStatus {
  databasePath: string
  exists: boolean
  currentVersion: number
  latestVersion: number
  appliedVersions: number[]
  pendingVersions: number[]
  unknownAppliedVersions: number[]
  upToDate: boolean
}

export interface MigrationDryRunResult {
  status: MigrationVersionStatus
  willApply: Array<{ version: number; transaction: boolean }>
  warnings: string[]
  changesDatabase: false
  userMessage: string
}

export interface DatabaseBackupResult {
  id: string
  kind: "backup" | "export" | "rollback"
  databasePath: string
  backupPath: string
  walPath?: string
  shmPath?: string
  checksum: string
  createdAt: number
}

export interface ConfigExportResult {
  id: string
  configPath: string
  exportPath: string
  checksum: string
  createdAt: number
  masking: {
    secretsMasked: number
    channelIdsMasked: false
    userIdsMasked: false
    policy: string
  }
}

export interface PromptSourceExportResult {
  exportPath: string
  checksum: string
  createdAt: number
  sourceCount: number
  sources: Array<{
    sourceId: string
    locale: "ko" | "en"
    path: string
    version: string
    priority: number
    enabled: boolean
    required: boolean
    usageScope: string
    checksum: string
  }>
}

export interface PromptSourceImportResult {
  exportPath: string
  imported: string[]
  skipped: string[]
  backups: Array<{
    backupId: string
    sourceId: string
    locale: "ko" | "en"
    sourcePath: string
    backupPath: string
    checksum: string
    createdAt: number
  }>
  registry: PromptSourceExportResult["sources"]
}

export interface ConfigurationOperationsSnapshot {
  database: MigrationVersionStatus
  promptSources: {
    workDir: string
    count: number
    versions: PromptSourceExportResult["sources"]
  }
  config: {
    configPath: string
    exists: boolean
    masked: Record<string, unknown>
    maskingPolicy: string
  }
}
