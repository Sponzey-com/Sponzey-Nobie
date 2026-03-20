import { spawn, spawnSync } from "node:child_process";
import { eventBus } from "../events/index.js";
export function resolveWorkerRuntimeTarget(kind) {
    switch (kind) {
        case "claude_code":
            return {
                kind,
                targetId: "worker:claude_code",
                label: "코드 작업 세션",
                command: process.env["NOBIE_CLAUDE_CODE_COMMAND"]?.trim() || "claude",
            };
        case "codex_cli":
            return {
                kind,
                targetId: "worker:codex_cli",
                label: "코드 작업 보조 세션",
                command: process.env["NOBIE_CODEX_CLI_COMMAND"]?.trim() || "codex",
            };
    }
}
export function isWorkerRuntimeAvailable(kind, overrides) {
    const override = overrides?.[kind];
    if (typeof override === "boolean")
        return override;
    const target = resolveWorkerRuntimeTarget(kind);
    try {
        const result = spawnSync(target.command, ["--version"], {
            stdio: "ignore",
            timeout: 3000,
        });
        if (result.error) {
            return false;
        }
        return result.status === 0 || result.status === 1;
    }
    catch {
        return false;
    }
}
export async function* runWorkerRuntime(params) {
    eventBus.emit("agent.start", { sessionId: params.sessionId, runId: params.runId });
    const args = buildWorkerArgs(params.runtime.kind, params.prompt);
    const child = spawn(params.runtime.command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        signal: params.signal,
        env: process.env,
    });
    let stderr = "";
    let completed = false;
    const stdoutIterator = streamIterator(child.stdout);
    const stderrIterator = streamIterator(child.stderr);
    const stderrPump = (async () => {
        for await (const chunk of stderrIterator) {
            stderr += chunk;
        }
    })();
    try {
        for await (const chunk of stdoutIterator) {
            if (!chunk)
                continue;
            eventBus.emit("agent.stream", { sessionId: params.sessionId, runId: params.runId, delta: chunk });
            yield { type: "text", delta: chunk };
        }
        const exitCode = await new Promise((resolve, reject) => {
            child.once("error", reject);
            child.once("close", (code) => resolve(code));
        });
        await stderrPump;
        if (exitCode !== 0) {
            const message = stderr.trim() || `${params.runtime.command} exited with code ${String(exitCode)}`;
            yield { type: "error", message };
            return;
        }
        completed = true;
        eventBus.emit("agent.end", { sessionId: params.sessionId, runId: params.runId, durationMs: 0 });
        yield { type: "done", totalTokens: 0 };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        yield { type: "error", message };
    }
    finally {
        if (!completed) {
            eventBus.emit("agent.end", { sessionId: params.sessionId, runId: params.runId, durationMs: 0 });
        }
    }
}
function buildWorkerArgs(kind, prompt) {
    switch (kind) {
        case "claude_code":
            return ["-p", prompt];
        case "codex_cli":
            return ["exec", prompt];
    }
}
async function* streamIterator(stream) {
    if (!stream)
        return;
    for await (const chunk of stream) {
        yield typeof chunk === "string" ? chunk : chunk.toString("utf-8");
    }
}
//# sourceMappingURL=worker-runtime.js.map