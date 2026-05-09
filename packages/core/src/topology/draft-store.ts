import {
  ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
  type EnterpriseTimestamp,
  type EnterpriseTopology,
  type EnterpriseTopologyValidationIssue,
  validateEnterpriseTopology,
} from "../contracts/enterprise-topology.js"

export type TopologyDraftSource = "memory" | "fixture" | "import"

export interface TopologyDocumentEnvelope {
  schemaVersion: typeof ENTERPRISE_TOPOLOGY_SCHEMA_VERSION
  envelopeId: string
  draftId: string
  topologyId: string
  name: string
  lifecycle: "draft"
  source: TopologyDraftSource
  sourceRef?: string
  document: EnterpriseTopology
  validation: {
    valid: true
    issueCount: 0
  }
  createdAt: EnterpriseTimestamp
  updatedAt: EnterpriseTimestamp
}

export interface SaveTopologyDraftInput {
  document: EnterpriseTopology
  draftId?: string
  envelopeId?: string
  source?: TopologyDraftSource
  sourceRef?: string
  now?: EnterpriseTimestamp
}

export type TopologyDraftStoreResult =
  | { ok: true; envelope: TopologyDocumentEnvelope; issues: [] }
  | { ok: false; issues: EnterpriseTopologyValidationIssue[] }

export interface TopologyDraftStore {
  saveDraft(input: SaveTopologyDraftInput): TopologyDraftStoreResult
  getDraft(draftId: string): TopologyDocumentEnvelope | undefined
  listDrafts(): TopologyDocumentEnvelope[]
  deleteDraft(draftId: string): boolean
  clear(): void
}

function cloneEnvelope(envelope: TopologyDocumentEnvelope): TopologyDocumentEnvelope {
  return structuredClone(envelope)
}

function defaultDraftId(topology: EnterpriseTopology): string {
  return `draft:${topology.id}`
}

function defaultEnvelopeId(draftId: string): string {
  return `envelope:${draftId}`
}

export function createTopologyDocumentEnvelope(input: SaveTopologyDraftInput): TopologyDraftStoreResult {
  const validation = validateEnterpriseTopology(input.document)
  if (!validation.ok) return { ok: false, issues: validation.issues }

  const draftId = input.draftId ?? defaultDraftId(validation.value)
  const now = input.now ?? Date.now()
  const envelope: TopologyDocumentEnvelope = {
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
  }
  return { ok: true, envelope, issues: [] }
}

export function createInMemoryTopologyDraftStore(initialDrafts: TopologyDocumentEnvelope[] = []): TopologyDraftStore {
  const drafts = new Map<string, TopologyDocumentEnvelope>()
  for (const draft of initialDrafts) {
    drafts.set(draft.draftId, cloneEnvelope(draft))
  }

  return {
    saveDraft(input) {
      const result = createTopologyDocumentEnvelope(input)
      if (!result.ok) return result
      const existing = drafts.get(result.envelope.draftId)
      const envelope: TopologyDocumentEnvelope = {
        ...result.envelope,
        createdAt: existing?.createdAt ?? result.envelope.createdAt,
      }
      drafts.set(envelope.draftId, cloneEnvelope(envelope))
      return { ok: true, envelope: cloneEnvelope(envelope), issues: [] }
    },
    getDraft(draftId) {
      const draft = drafts.get(draftId)
      return draft ? cloneEnvelope(draft) : undefined
    },
    listDrafts() {
      return [...drafts.values()].map(cloneEnvelope)
    },
    deleteDraft(draftId) {
      return drafts.delete(draftId)
    },
    clear() {
      drafts.clear()
    },
  }
}
