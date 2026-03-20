/**
 * PluginLoader — loads, initializes, and manages plugin lifecycle.
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { getDb } from "../db/index.js";
import { toolDispatcher } from "../tools/dispatcher.js";
import { createLogger } from "../logger/index.js";
import { getConfig } from "../config/index.js";
const log = createLogger("plugins");
export class PluginLoader {
    loaded = new Map();
    /** Load all enabled plugins from the DB */
    async loadAll() {
        const db = getDb();
        const rows = db
            .prepare("SELECT * FROM plugins WHERE enabled = 1")
            .all();
        for (const meta of rows) {
            await this.load(meta).catch((err) => {
                log.error(`Failed to load plugin "${meta.name}": ${err instanceof Error ? err.message : String(err)}`);
            });
        }
        log.info(`Loaded ${this.loaded.size} plugin(s)`);
    }
    /** Load a single plugin by meta */
    async load(meta) {
        if (this.loaded.has(meta.name))
            return;
        const entryPath = resolve(meta.entry_path);
        if (!existsSync(entryPath)) {
            throw new Error(`Plugin entry not found: ${entryPath}`);
        }
        const mod = await import(entryPath);
        const plugin = mod.default;
        if (!plugin || typeof plugin.initialize !== "function") {
            throw new Error(`Plugin "${meta.name}" does not export a valid NobiePlugin as default`);
        }
        const ctx = this.buildContext(meta);
        await plugin.initialize(ctx);
        this.loaded.set(meta.name, { plugin, meta });
        log.info(`Plugin "${meta.name}" v${meta.version} loaded`);
    }
    /** Unload a single plugin by name */
    async unload(name) {
        const entry = this.loaded.get(name);
        if (!entry)
            return;
        await entry.plugin.teardown?.();
        this.loaded.delete(name);
        log.info(`Plugin "${name}" unloaded`);
    }
    /** Enable a plugin in DB and load it */
    async enable(name) {
        const db = getDb();
        db.prepare("UPDATE plugins SET enabled = 1, updated_at = ? WHERE name = ?").run(Date.now(), name);
        const meta = db.prepare("SELECT * FROM plugins WHERE name = ?").get(name);
        if (meta)
            await this.load(meta);
    }
    /** Disable a plugin in DB and unload it */
    async disable(name) {
        const db = getDb();
        db.prepare("UPDATE plugins SET enabled = 0, updated_at = ? WHERE name = ?").run(Date.now(), name);
        await this.unload(name);
    }
    /** Register a plugin into the DB */
    static register(opts) {
        const db = getDb();
        const now = Date.now();
        const id = crypto.randomUUID();
        const existing = db
            .prepare("SELECT * FROM plugins WHERE name = ?")
            .get(opts.name);
        if (existing) {
            db.prepare("UPDATE plugins SET version = ?, description = ?, entry_path = ?, config = ?, updated_at = ? WHERE name = ?").run(opts.version, opts.description ?? null, opts.entryPath, JSON.stringify(opts.config ?? {}), now, opts.name);
            return db.prepare("SELECT * FROM plugins WHERE name = ?").get(opts.name);
        }
        db.prepare(`INSERT INTO plugins (id, name, version, description, entry_path, enabled, config, installed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`).run(id, opts.name, opts.version, opts.description ?? null, opts.entryPath, JSON.stringify(opts.config ?? {}), now, now);
        return db.prepare("SELECT * FROM plugins WHERE id = ?").get(id);
    }
    /** Remove a plugin from the DB */
    static unregister(name) {
        getDb().prepare("DELETE FROM plugins WHERE name = ?").run(name);
    }
    /** List all plugins from DB */
    static list() {
        return getDb().prepare("SELECT * FROM plugins ORDER BY installed_at DESC").all();
    }
    getLoadedNames() {
        return Array.from(this.loaded.keys());
    }
    buildContext(meta) {
        return {
            registerTools(tools) {
                toolDispatcher.registerAll(tools);
            },
            getConfig(keyPath) {
                const cfg = getConfig();
                const parts = keyPath.split(".");
                let cur = cfg;
                for (const part of parts) {
                    if (cur == null || typeof cur !== "object")
                        return undefined;
                    cur = cur[part];
                }
                return cur;
            },
            log(level, message) {
                log[level](`[plugin:${meta.name}] ${message}`);
            },
        };
    }
}
export const pluginLoader = new PluginLoader();
//# sourceMappingURL=loader.js.map