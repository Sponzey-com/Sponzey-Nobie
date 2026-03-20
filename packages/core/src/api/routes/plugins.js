import { authMiddleware } from "../middleware/auth.js";
import { PluginLoader, pluginLoader } from "../../plugins/loader.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
export function registerPluginsRoute(app) {
    // GET /api/plugins — list all plugins
    app.get("/api/plugins", { preHandler: authMiddleware }, async () => {
        const plugins = PluginLoader.list();
        const loaded = new Set(pluginLoader.getLoadedNames());
        return plugins.map((p) => ({
            ...p,
            config: JSON.parse(p.config ?? "{}"),
            is_loaded: loaded.has(p.name),
        }));
    });
    // GET /api/plugins/:name — single plugin details
    app.get("/api/plugins/:name", { preHandler: authMiddleware }, async (req, reply) => {
        const all = PluginLoader.list();
        const plugin = all.find((p) => p.name === req.params.name);
        if (!plugin)
            return reply.code(404).send({ error: "Plugin not found" });
        const loaded = pluginLoader.getLoadedNames().includes(plugin.name);
        return { ...plugin, config: JSON.parse(plugin.config ?? "{}"), is_loaded: loaded };
    });
    // POST /api/plugins — register/install a plugin
    app.post("/api/plugins", { preHandler: authMiddleware }, async (req, reply) => {
        const { name, version, description, entryPath, config } = req.body;
        if (!name || !version || !entryPath) {
            return reply.code(400).send({ error: "name, version, entryPath required" });
        }
        const absPath = resolve(entryPath);
        if (!existsSync(absPath)) {
            return reply.code(400).send({ error: `Entry path does not exist: ${absPath}` });
        }
        const meta = PluginLoader.register({
            name,
            version,
            ...(description !== undefined && { description }),
            entryPath: absPath,
            ...(config !== undefined && { config }),
        });
        return meta;
    });
    // PATCH /api/plugins/:name — enable/disable or update config
    app.patch("/api/plugins/:name", { preHandler: authMiddleware }, async (req, reply) => {
        const { name } = req.params;
        const { enabled, config } = req.body;
        const db = (await import("../../db/index.js")).getDb();
        const existing = db.prepare("SELECT id FROM plugins WHERE name = ?").get(name);
        if (!existing)
            return reply.code(404).send({ error: "Plugin not found" });
        if (enabled === true) {
            await pluginLoader.enable(name);
        }
        else if (enabled === false) {
            await pluginLoader.disable(name);
        }
        if (config !== undefined) {
            db.prepare("UPDATE plugins SET config = ?, updated_at = ? WHERE name = ?").run(JSON.stringify(config), Date.now(), name);
        }
        const updated = PluginLoader.list().find((p) => p.name === name);
        return updated;
    });
    // DELETE /api/plugins/:name — uninstall a plugin
    app.delete("/api/plugins/:name", { preHandler: authMiddleware }, async (req, reply) => {
        const { name } = req.params;
        await pluginLoader.unload(name);
        PluginLoader.unregister(name);
        return reply.code(204).send();
    });
}
//# sourceMappingURL=plugins.js.map