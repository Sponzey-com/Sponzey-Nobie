import crypto from "node:crypto";
export function stableAdapterChecksum(input) {
    return crypto.createHash("sha256").update(JSON.stringify({
        adapterId: input.adapterId,
        adapterVersion: input.adapterVersion,
        parserVersion: input.parserVersion,
        sourceDomains: [...input.sourceDomains].sort(),
        supportedTargetKinds: [...input.supportedTargetKinds].sort(),
    })).digest("hex").slice(0, 16);
}
export function withAdapterChecksum(input) {
    return {
        ...input,
        checksum: stableAdapterChecksum(input),
        status: input.status ?? "active",
    };
}
export function compareAdapterFixtureParserVersion(input) {
    const ok = input.metadata.parserVersion === input.expectedParserVersion;
    return {
        ok,
        adapterId: input.metadata.adapterId,
        expectedParserVersion: input.expectedParserVersion,
        actualParserVersion: input.metadata.parserVersion,
        message: ok
            ? "adapter fixture parser version matches"
            : `adapter fixture parser version mismatch: expected ${input.expectedParserVersion}, actual ${input.metadata.parserVersion}`,
    };
}
//# sourceMappingURL=types.js.map