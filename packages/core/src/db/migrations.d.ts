import type Database from "better-sqlite3";
export interface Migration {
    version: number;
    up: (db: Database.Database) => void;
}
export declare const MIGRATIONS: Migration[];
export declare function runMigrations(db: Database.Database): void;
//# sourceMappingURL=migrations.d.ts.map