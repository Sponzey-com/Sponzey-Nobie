import { authMiddleware } from "../middleware/auth.js";
import { checkForUpdates, getUpdateSnapshot } from "../../update/service.js";
export function registerUpdateRoute(app) {
    app.get("/api/update/status", { preHandler: authMiddleware }, async () => {
        return getUpdateSnapshot();
    });
    app.post("/api/update/check", { preHandler: authMiddleware }, async () => {
        return checkForUpdates();
    });
}
//# sourceMappingURL=update.js.map