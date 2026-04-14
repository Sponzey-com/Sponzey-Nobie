import type Database from "better-sqlite3";
export interface Migration {
    version: number;
    transaction?: boolean;
    up: (db: Database.Database) => void;
}
export declare const MIGRATIONS: Migration[];
export declare function getAppliedMigrationVersions(db: Database.Database): number[];
export declare function getPendingMigrationVersions(db: Database.Database): number[];
export declare function createPreMigrationBackupIfNeeded(db: Database.Database, dbPath: string, backupDir: string): string | null;
export declare function runMigrations(db: Database.Database): void;
//# sourceMappingURL=migrations.d.ts.map