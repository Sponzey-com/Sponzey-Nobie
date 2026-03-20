import { authMiddleware } from "../middleware/auth.js";
import { scheduler } from "../../scheduler/index.js";
export function registerSchedulerRoute(app) {
    // GET /api/scheduler/health
    app.get("/api/scheduler/health", { preHandler: authMiddleware }, async () => {
        return scheduler.getHealth();
    });
}
//# sourceMappingURL=scheduler.js.map