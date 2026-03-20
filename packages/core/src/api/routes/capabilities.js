import { authMiddleware } from "../middleware/auth.js";
import { createCapabilities } from "../../control-plane/index.js";
export function registerCapabilitiesRoute(app) {
    app.get("/api/capabilities", { preHandler: authMiddleware }, async () => {
        return {
            items: createCapabilities(),
            generatedAt: Date.now(),
        };
    });
    app.get("/api/capabilities/:key", { preHandler: authMiddleware }, async (req, reply) => {
        const item = createCapabilities().find((capability) => capability.key === req.params.key);
        if (!item) {
            return reply.status(404).send({ error: "Capability not found" });
        }
        return item;
    });
}
//# sourceMappingURL=capabilities.js.map