/**
 * PluginLoader — loads, initializes, and manages plugin lifecycle.
 */
import type { PluginMeta } from "./types.js";
export declare class PluginLoader {
    private loaded;
    /** Load all enabled plugins from the DB */
    loadAll(): Promise<void>;
    /** Load a single plugin by meta */
    load(meta: PluginMeta): Promise<void>;
    /** Unload a single plugin by name */
    unload(name: string): Promise<void>;
    /** Enable a plugin in DB and load it */
    enable(name: string): Promise<void>;
    /** Disable a plugin in DB and unload it */
    disable(name: string): Promise<void>;
    /** Register a plugin into the DB */
    static register(opts: {
        name: string;
        version: string;
        description?: string;
        entryPath: string;
        config?: Record<string, unknown>;
    }): PluginMeta;
    /** Remove a plugin from the DB */
    static unregister(name: string): void;
    /** List all plugins from DB */
    static list(): PluginMeta[];
    getLoadedNames(): string[];
    private buildContext;
}
export declare const pluginLoader: PluginLoader;
//# sourceMappingURL=loader.d.ts.map