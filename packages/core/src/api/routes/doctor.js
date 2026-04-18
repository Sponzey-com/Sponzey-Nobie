import { runDoctor, writeDoctorReportArtifact } from "../../diagnostics/doctor.js";
import { authMiddleware } from "../middleware/auth.js";
function resolveMode(value) {
    return value === "full" ? "full" : "quick";
}
export function registerDoctorRoute(app) {
    app.get("/api/doctor", { preHandler: authMiddleware }, async (req) => {
        const report = runDoctor({ mode: resolveMode(req.query.mode) });
        const artifactPath = req.query.write === "1" || req.query.write === "true"
            ? writeDoctorReportArtifact(report)
            : null;
        return { ok: true, report, artifactPath };
    });
}
//# sourceMappingURL=doctor.js.map