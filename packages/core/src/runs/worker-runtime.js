export function resolveWorkerRuntimeTarget(kind) {
    return {
        kind,
        targetId: `worker:${kind}`,
        label: "비활성화된 외부 작업 세션",
    };
}
export function isWorkerRuntimeAvailable(_kind, _overrides) {
    return false;
}
export async function* runWorkerRuntime(_params) {
    yield {
        type: "error",
        message: "External worker runtime execution is removed. Use the configured AI backend only.",
    };
}
//# sourceMappingURL=worker-runtime.js.map
