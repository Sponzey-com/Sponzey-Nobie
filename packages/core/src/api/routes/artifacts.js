import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { PATHS } from "../../config/index.js";
import { authMiddleware } from "../middleware/auth.js";
function resolveArtifactFile(encodedPath) {
    const artifactsRoot = join(PATHS.stateDir, "artifacts");
    const candidate = resolve(artifactsRoot, encodedPath);
    if (candidate !== artifactsRoot && !candidate.startsWith(`${artifactsRoot}${sep}`)) {
        return null;
    }
    return candidate;
}
function guessMimeType(filePath) {
    switch (extname(filePath).toLowerCase()) {
        case ".png":
            return "image/png";
        case ".jpg":
        case ".jpeg":
            return "image/jpeg";
        case ".webp":
            return "image/webp";
        case ".gif":
            return "image/gif";
        case ".pdf":
            return "application/pdf";
        case ".txt":
        case ".log":
        case ".md":
            return "text/plain; charset=utf-8";
        default:
            return "application/octet-stream";
    }
}
export function registerArtifactsRoute(app) {
    app.get("/api/artifacts/*", { preHandler: authMiddleware }, async (req, reply) => {
        const encodedPath = req.params["*"] ?? "";
        const filePath = resolveArtifactFile(encodedPath);
        if (!filePath) {
            return reply.status(403).send({ error: "Forbidden" });
        }
        if (!existsSync(filePath)) {
            return reply.status(404).send({ error: "Artifact not found" });
        }
        const stat = statSync(filePath);
        if (!stat.isFile()) {
            return reply.status(404).send({ error: "Artifact not found" });
        }
        reply.header("Cache-Control", "private, max-age=300");
        reply.type(guessMimeType(filePath));
        return reply.send(createReadStream(filePath));
    });
}
//# sourceMappingURL=artifacts.js.map