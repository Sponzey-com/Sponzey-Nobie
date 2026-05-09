import { ENTERPRISE_TOPOLOGY_SCHEMA_VERSION, validateEnterpriseTopology, } from "../contracts/enterprise-topology.js";
function cloneEnvelope(envelope) {
    return structuredClone(envelope);
}
function defaultDraftId(topology) {
    return `draft:${topology.id}`;
}
function defaultEnvelopeId(draftId) {
    return `envelope:${draftId}`;
}
export function createTopologyDocumentEnvelope(input) {
    const validation = validateEnterpriseTopology(input.document);
    if (!validation.ok)
        return { ok: false, issues: validation.issues };
    const draftId = input.draftId ?? defaultDraftId(validation.value);
    const now = input.now ?? Date.now();
    const envelope = {
        schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
        envelopeId: input.envelopeId ?? defaultEnvelopeId(draftId),
        draftId,
        topologyId: validation.value.id,
        name: validation.value.name,
        lifecycle: "draft",
        source: input.source ?? "memory",
        ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
        document: validation.value,
        validation: {
            valid: true,
            issueCount: 0,
        },
        createdAt: now,
        updatedAt: now,
    };
    return { ok: true, envelope, issues: [] };
}
export function createInMemoryTopologyDraftStore(initialDrafts = []) {
    const drafts = new Map();
    for (const draft of initialDrafts) {
        drafts.set(draft.draftId, cloneEnvelope(draft));
    }
    return {
        saveDraft(input) {
            const result = createTopologyDocumentEnvelope(input);
            if (!result.ok)
                return result;
            const existing = drafts.get(result.envelope.draftId);
            const envelope = {
                ...result.envelope,
                createdAt: existing?.createdAt ?? result.envelope.createdAt,
            };
            drafts.set(envelope.draftId, cloneEnvelope(envelope));
            return { ok: true, envelope: cloneEnvelope(envelope), issues: [] };
        },
        getDraft(draftId) {
            const draft = drafts.get(draftId);
            return draft ? cloneEnvelope(draft) : undefined;
        },
        listDrafts() {
            return [...drafts.values()].map(cloneEnvelope);
        },
        deleteDraft(draftId) {
            return drafts.delete(draftId);
        },
        clear() {
            drafts.clear();
        },
    };
}
//# sourceMappingURL=draft-store.js.map