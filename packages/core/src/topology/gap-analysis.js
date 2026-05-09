import { createHash } from "node:crypto";
import { getDb } from "../db/index.js";
import { assertMigrationWriteAllowed } from "../db/migration-safety.js";
import { extractObservedTopologyEdges, } from "./observed.js";
import { projectEnterpriseOrgWorkloadMetrics } from "./metrics.js";
const DECLARED_OBSERVED_COMPARABLE_TYPES = new Set([
    "delegates_to",
    "uses_tool",
    "uses_system",
    "owns",
    "approves",
    "accountable_for",
    "depends_on",
]);
const HIGH_SEVERITIES = new Set(["high", "critical"]);
function hashText(value) {
    return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
function refKey(ref) {
    return `${ref.entityType}:${ref.id}`;
}
function edgeEndpointKey(input) {
    return `${input.relationType}|${refKey(input.from)}->${refKey(input.to)}`;
}
function endpointOnlyKey(input) {
    return `${refKey(input.from)}->${refKey(input.to)}`;
}
function findingId(input) {
    return `finding:${input.topologyId}:${input.kind}:${hashText(`${input.subject}|${input.reasonCode ?? ""}`)}`;
}
function diffId(input) {
    return `diff:${hashText(`${input.topologyId}|${input.kind}|${edgeEndpointKey(input)}`)}`;
}
function cloneRef(ref) {
    return { entityType: ref.entityType, id: ref.id };
}
function addUniqueRef(refs, ref) {
    if (refs.some((item) => refKey(item) === refKey(ref)))
        return refs;
    return [...refs, cloneRef(ref)];
}
function declaredEdge(input) {
    const edgeId = input.edgeId ?? `declared:${hashText(`${input.topologyId}|${input.relationType}|${refKey(input.from)}|${refKey(input.to)}|${input.source}`)}`;
    const edge = {
        edgeId,
        topologyId: input.topologyId,
        relationType: input.relationType,
        from: cloneRef(input.from),
        to: cloneRef(input.to),
        source: input.source,
        evidence: { ...input.evidence },
    };
    if (input.relationId !== undefined)
        edge.relationId = input.relationId;
    if (input.nodeId !== undefined)
        edge.nodeId = input.nodeId;
    return edge;
}
function buildDeclaredTopologyEdges(topology) {
    const edges = [];
    for (const relation of topology.relations) {
        edges.push(declaredEdge({
            edgeId: `declared:${relation.id}`,
            topologyId: topology.id,
            relationType: relation.relationType,
            from: relation.from,
            to: relation.to,
            source: "relation",
            relationId: relation.id,
            evidence: { relationId: relation.id, relationName: relation.name },
        }));
    }
    for (const node of topology.nodes) {
        for (const childNodeId of node.children) {
            edges.push(declaredEdge({
                topologyId: topology.id,
                relationType: "delegates_to",
                from: { entityType: "node", id: node.id },
                to: { entityType: "node", id: childNodeId },
                source: "node_children",
                nodeId: node.id,
                evidence: { nodeId: node.id, sourceField: "children" },
            }));
        }
        if (node.owner !== undefined) {
            edges.push(declaredEdge({
                topologyId: topology.id,
                relationType: "owns",
                from: node.owner,
                to: { entityType: "node", id: node.id },
                source: "node_owner",
                nodeId: node.id,
                evidence: { nodeId: node.id, sourceField: "owner" },
            }));
        }
    }
    for (const responsibility of topology.responsibilities) {
        edges.push(declaredEdge({
            topologyId: topology.id,
            relationType: "accountable_for",
            from: responsibility.accountable ?? responsibility.responsible,
            to: responsibility.scope,
            source: "responsibility",
            relationId: responsibility.id,
            evidence: { responsibilityId: responsibility.id },
        }));
    }
    return dedupeDeclaredEdges(edges);
}
function dedupeDeclaredEdges(edges) {
    const byKey = new Map();
    for (const edge of edges) {
        const key = `${edgeEndpointKey(edge)}|${edge.source}`;
        if (!byKey.has(key))
            byKey.set(key, edge);
    }
    return [...byKey.values()].sort((left, right) => left.edgeId.localeCompare(right.edgeId));
}
function computeDiffs(topologyId, declaredEdges, observedEdges) {
    const declaredComparable = declaredEdges.filter((edge) => DECLARED_OBSERVED_COMPARABLE_TYPES.has(edge.relationType));
    const observedComparable = observedEdges.filter((edge) => DECLARED_OBSERVED_COMPARABLE_TYPES.has(edge.relationType));
    const declaredByKey = new Map(declaredComparable.map((edge) => [edgeEndpointKey(edge), edge]));
    const observedByKey = new Map(observedComparable.map((edge) => [edgeEndpointKey(edge), edge]));
    const declaredEndpointType = new Map(declaredComparable.map((edge) => [endpointOnlyKey(edge), edge]));
    const observedEndpointType = new Map(observedComparable.map((edge) => [endpointOnlyKey(edge), edge]));
    const diffs = [];
    for (const observed of observedComparable) {
        const key = edgeEndpointKey(observed);
        const declared = declaredByKey.get(key);
        if (declared !== undefined) {
            diffs.push({
                diffId: diffId({ topologyId, kind: "matched", relationType: observed.relationType, from: observed.from, to: observed.to }),
                kind: "matched",
                relationType: observed.relationType,
                from: cloneRef(observed.from),
                to: cloneRef(observed.to),
                declaredEdge: declared,
                observedEdge: observed,
                reasonCode: "declared_observed_relation_matched",
            });
            continue;
        }
        const sameEndpointDeclared = declaredEndpointType.get(endpointOnlyKey(observed));
        if (sameEndpointDeclared !== undefined) {
            diffs.push({
                diffId: diffId({ topologyId, kind: "mismatched_relation", relationType: observed.relationType, from: observed.from, to: observed.to }),
                kind: "mismatched_relation",
                relationType: observed.relationType,
                from: cloneRef(observed.from),
                to: cloneRef(observed.to),
                declaredEdge: sameEndpointDeclared,
                observedEdge: observed,
                reasonCode: "declared_observed_relation_type_mismatch",
            });
            continue;
        }
        diffs.push({
            diffId: diffId({ topologyId, kind: "observed_only", relationType: observed.relationType, from: observed.from, to: observed.to }),
            kind: "observed_only",
            relationType: observed.relationType,
            from: cloneRef(observed.from),
            to: cloneRef(observed.to),
            observedEdge: observed,
            reasonCode: "observed_relation_not_declared",
        });
    }
    for (const declared of declaredComparable) {
        const key = edgeEndpointKey(declared);
        if (observedByKey.has(key))
            continue;
        if (observedEndpointType.has(endpointOnlyKey(declared)))
            continue;
        diffs.push({
            diffId: diffId({ topologyId, kind: "declared_only", relationType: declared.relationType, from: declared.from, to: declared.to }),
            kind: "declared_only",
            relationType: declared.relationType,
            from: cloneRef(declared.from),
            to: cloneRef(declared.to),
            declaredEdge: declared,
            reasonCode: "declared_relation_not_observed",
        });
    }
    return diffs.sort((left, right) => left.kind.localeCompare(right.kind) || left.diffId.localeCompare(right.diffId));
}
function createFinding(input) {
    const relatedEntities = input.relatedEntities ?? [];
    const relatedRelations = input.relatedRelations ?? [];
    const relatedRuns = input.relatedRuns ?? [];
    const subject = [
        input.summary,
        relatedEntities.map(refKey).join(","),
        relatedRelations.join(","),
        relatedRuns.join(","),
    ].join("|");
    const finding = {
        findingId: findingId({
            topologyId: input.topologyId,
            kind: input.findingKind,
            subject,
            ...(input.reasonCode !== undefined ? { reasonCode: input.reasonCode } : {}),
        }),
        topologyId: input.topologyId,
        findingKind: input.findingKind,
        severity: input.severity,
        status: "open",
        summary: input.summary,
        recommendation: input.recommendation,
        relatedEntities,
        relatedRelations,
        relatedRuns,
        detail: {
            ...(input.detail ?? {}),
            ...(input.reasonCode !== undefined ? { reasonCode: input.reasonCode } : {}),
        },
        createdAt: input.now,
        updatedAt: input.now,
    };
    if (input.topologyRunId !== undefined)
        finding.topologyRunId = input.topologyRunId;
    return finding;
}
function nodeOwnerRefs(topology, declaredEdges) {
    const owners = new Map();
    for (const edge of declaredEdges) {
        if (edge.relationType !== "owns" || edge.to.entityType !== "node")
            continue;
        owners.set(edge.to.id, addUniqueRef(owners.get(edge.to.id) ?? [], edge.from));
    }
    for (const entry of topology.responsibilities) {
        if (entry.scope.entityType !== "node")
            continue;
        owners.set(entry.scope.id, addUniqueRef(owners.get(entry.scope.id) ?? [], entry.responsible));
        if (entry.accountable !== undefined) {
            owners.set(entry.scope.id, addUniqueRef(owners.get(entry.scope.id) ?? [], entry.accountable));
        }
    }
    return owners;
}
function nodeHasBackup(topology, node) {
    if ((node.failurePolicy?.fallbackNodeIds.length ?? 0) > 0)
        return true;
    const owner = node.owner;
    if (owner?.entityType !== "position")
        return false;
    const position = topology.positions.find((candidate) => candidate.id === owner.id);
    return typeof position?.backupPositionId === "string" && position.backupPositionId.length > 0;
}
function detectRelationFindings(topology, diffs, now) {
    return diffs
        .filter((diff) => diff.kind === "observed_only" || diff.kind === "declared_only" || diff.kind === "mismatched_relation")
        .map((diff) => {
        const relatedEntities = [diff.from, diff.to];
        const relatedRelations = [
            ...(diff.declaredEdge?.relationId !== undefined ? [diff.declaredEdge.relationId] : []),
        ];
        const relatedRuns = [
            ...(diff.observedEdge?.topologyRunId !== undefined ? [diff.observedEdge.topologyRunId] : []),
        ];
        if (diff.kind === "observed_only") {
            const topologyRunId = diff.observedEdge?.topologyRunId;
            return createFinding({
                topologyId: topology.id,
                ...(topologyRunId !== undefined ? { topologyRunId } : {}),
                findingKind: "observed_only_relation",
                severity: diff.relationType === "uses_tool" ? "high" : "medium",
                summary: `Observed ${diff.relationType} relation is not declared: ${refKey(diff.from)} -> ${refKey(diff.to)}.`,
                recommendation: "Review whether this operational relation should be declared, approved, or blocked.",
                relatedEntities,
                relatedRelations,
                relatedRuns,
                reasonCode: "observed_relation_not_declared",
                detail: { diffId: diff.diffId, relationType: diff.relationType },
                now,
            });
        }
        if (diff.kind === "mismatched_relation") {
            const topologyRunId = diff.observedEdge?.topologyRunId;
            return createFinding({
                topologyId: topology.id,
                ...(topologyRunId !== undefined ? { topologyRunId } : {}),
                findingKind: "mismatched_relation",
                severity: "high",
                summary: `Observed relation type differs from declaration for ${refKey(diff.from)} -> ${refKey(diff.to)}.`,
                recommendation: "Align the declared relation type with the actual operating relation or correct the runtime route.",
                relatedEntities,
                relatedRelations,
                relatedRuns,
                reasonCode: diff.relationType === "owns" ? "declared_observed_owner_mismatch" : "declared_observed_relation_type_mismatch",
                detail: {
                    diffId: diff.diffId,
                    declaredRelationType: diff.declaredEdge?.relationType,
                    observedRelationType: diff.observedEdge?.relationType,
                },
                now,
            });
        }
        return createFinding({
            topologyId: topology.id,
            findingKind: "declared_only_relation",
            severity: diff.relationType === "delegates_to" ? "medium" : "low",
            summary: `Declared ${diff.relationType} relation has not been observed: ${refKey(diff.from)} -> ${refKey(diff.to)}.`,
            recommendation: "Confirm whether this declared relation is still valid or has not yet received traffic.",
            relatedEntities,
            relatedRelations,
            reasonCode: "declared_relation_not_observed",
            detail: { diffId: diff.diffId, relationType: diff.relationType },
            now,
        });
    });
}
function detectOwnerMismatchFindings(topology, declaredEdges, observedEdges, now) {
    const owners = nodeOwnerRefs(topology, declaredEdges);
    const findings = [];
    for (const observed of observedEdges) {
        if (observed.relationType !== "owns" || observed.to.entityType !== "node")
            continue;
        const declaredOwners = owners.get(observed.to.id) ?? [];
        if (declaredOwners.length === 0 || declaredOwners.some((owner) => refKey(owner) === refKey(observed.from)))
            continue;
        const topologyRunId = observed.topologyRunId;
        findings.push(createFinding({
            topologyId: topology.id,
            ...(topologyRunId !== undefined ? { topologyRunId } : {}),
            findingKind: "mismatched_relation",
            severity: "high",
            summary: `Observed owner ${refKey(observed.from)} differs from declared owner for ${observed.to.id}.`,
            recommendation: "Confirm the accountable owner and update either the declared owner or the operating handoff.",
            relatedEntities: [observed.from, observed.to, ...declaredOwners],
            relatedRuns: observed.topologyRunId !== undefined ? [observed.topologyRunId] : [],
            reasonCode: "declared_observed_owner_mismatch",
            detail: {
                observedEdgeId: observed.edgeId,
                declaredOwners: declaredOwners.map(refKey),
                observedOwner: refKey(observed.from),
            },
            now,
        }));
    }
    return findings;
}
function detectStructuralRiskFindings(topology, declaredEdges, observedEdges, options) {
    const findings = [];
    const owners = nodeOwnerRefs(topology, declaredEdges);
    const incomingDelegation = new Map();
    const outgoingDelegation = new Map();
    const observedNodeLoad = new Map();
    for (const edge of declaredEdges) {
        if (edge.relationType === "delegates_to" && edge.from.entityType === "node" && edge.to.entityType === "node") {
            outgoingDelegation.set(edge.from.id, (outgoingDelegation.get(edge.from.id) ?? 0) + 1);
            incomingDelegation.set(edge.to.id, (incomingDelegation.get(edge.to.id) ?? 0) + 1);
        }
    }
    for (const edge of observedEdges) {
        if (edge.from.entityType === "node")
            observedNodeLoad.set(edge.from.id, (observedNodeLoad.get(edge.from.id) ?? 0) + 1);
        if (edge.to.entityType === "node")
            observedNodeLoad.set(edge.to.id, (observedNodeLoad.get(edge.to.id) ?? 0) + 1);
    }
    for (const node of topology.nodes) {
        const relatedNode = { entityType: "node", id: node.id };
        const ownerRefs = owners.get(node.id) ?? [];
        if (ownerRefs.length === 0) {
            findings.push(createFinding({
                topologyId: topology.id,
                findingKind: "unclear_owner",
                severity: "medium",
                summary: `Node ${node.id} has no declared owner or responsibility owner.`,
                recommendation: "Assign a position, person, org unit, or node owner before routing production work through this node.",
                relatedEntities: [relatedNode],
                reasonCode: "node_owner_missing",
                now: options.now,
            }));
        }
        if (ownerRefs.length > 1) {
            findings.push(createFinding({
                topologyId: topology.id,
                findingKind: "duplicate_owner",
                severity: "medium",
                summary: `Node ${node.id} has multiple declared owners.`,
                recommendation: "Choose one accountable owner and move the rest to consulted or informed responsibility roles.",
                relatedEntities: [relatedNode, ...ownerRefs],
                reasonCode: "node_duplicate_owner",
                detail: { owners: ownerRefs.map(refKey) },
                now: options.now,
            }));
        }
        const hasRuntimeRole = (incomingDelegation.get(node.id) ?? 0) > 0 || (outgoingDelegation.get(node.id) ?? 0) > 0;
        if (hasRuntimeRole && !nodeHasBackup(topology, node)) {
            findings.push(createFinding({
                topologyId: topology.id,
                findingKind: "single_point_of_failure",
                severity: "high",
                summary: `Node ${node.id} participates in execution flow but has no fallback node or owner backup.`,
                recommendation: "Add a fallback node or assign a backup position for this execution node.",
                relatedEntities: [relatedNode, ...ownerRefs],
                reasonCode: "execution_node_without_backup",
                detail: {
                    incomingDelegationCount: incomingDelegation.get(node.id) ?? 0,
                    outgoingDelegationCount: outgoingDelegation.get(node.id) ?? 0,
                },
                now: options.now,
            }));
        }
        if ((node.failurePolicy?.failureReportRequired ?? false) && (node.failurePolicy?.fallbackNodeIds.length ?? 0) === 0) {
            findings.push(createFinding({
                topologyId: topology.id,
                findingKind: "missing_backup",
                severity: "medium",
                summary: `Node ${node.id} requires failure reporting but has no fallback route.`,
                recommendation: "Define fallbackNodeIds or document why this node can safely fail closed.",
                relatedEntities: [relatedNode],
                reasonCode: "failure_node_missing_fallback",
                now: options.now,
            }));
        }
        const observedLoad = observedNodeLoad.get(node.id) ?? 0;
        if (observedLoad >= options.overloadedNodeThreshold) {
            findings.push(createFinding({
                topologyId: topology.id,
                findingKind: "overloaded_node",
                severity: "medium",
                summary: `Node ${node.id} appears in ${observedLoad} observed runtime edges.`,
                recommendation: "Split repeated handoffs or add sibling nodes before this node becomes an operational bottleneck.",
                relatedEntities: [relatedNode],
                reasonCode: "observed_node_edge_load_high",
                detail: { observedEdgeLoad: observedLoad, threshold: options.overloadedNodeThreshold },
                now: options.now,
            }));
        }
    }
    const approvalByApprover = new Map();
    for (const relation of topology.relations) {
        if (relation.relationType !== "approves")
            continue;
        const key = refKey(relation.from);
        const current = approvalByApprover.get(key) ?? { approver: relation.from, targets: [], relationIds: [] };
        current.targets = addUniqueRef(current.targets, relation.to);
        current.relationIds.push(relation.id);
        approvalByApprover.set(key, current);
    }
    for (const item of approvalByApprover.values()) {
        if (item.targets.length < 2)
            continue;
        findings.push(createFinding({
            topologyId: topology.id,
            findingKind: "approval_bottleneck",
            severity: "high",
            summary: `${refKey(item.approver)} approves ${item.targets.length} topology targets.`,
            recommendation: "Delegate approval authority or add backup approvers for high-volume approval targets.",
            relatedEntities: [item.approver, ...item.targets],
            relatedRelations: item.relationIds,
            reasonCode: "single_approver_multiple_targets",
            detail: { approvalTargetCount: item.targets.length },
            now: options.now,
        }));
    }
    for (const responsibility of topology.responsibilities) {
        if (responsibility.accountable !== undefined)
            continue;
        findings.push(createFinding({
            topologyId: topology.id,
            findingKind: "raci_incomplete",
            severity: "medium",
            summary: `Responsibility ${responsibility.id} has no accountable owner.`,
            recommendation: "Assign one accountable owner and keep additional participants as consulted or informed.",
            relatedEntities: [responsibility.scope, responsibility.responsible],
            relatedRelations: [responsibility.id],
            reasonCode: "raci_accountable_missing",
            detail: { responsibilityId: responsibility.id },
            now: options.now,
        }));
    }
    for (const process of topology.processes) {
        const relatedProcess = { entityType: "process_definition", id: process.id };
        const missingOwner = process.ownerNodeId === undefined && process.accountablePositionId === undefined;
        const missingSteps = process.stepNodeIds.length === 0;
        if (missingOwner || missingSteps) {
            findings.push(createFinding({
                topologyId: topology.id,
                findingKind: "orphan_process",
                severity: missingSteps ? "high" : "medium",
                summary: `Process ${process.id} is missing ${missingOwner && missingSteps ? "owner and steps" : missingOwner ? "owner" : "steps"}.`,
                recommendation: "Assign an owner node or accountable position and ensure the process has executable step nodes.",
                relatedEntities: [relatedProcess],
                reasonCode: missingSteps ? "process_steps_missing" : "process_owner_missing",
                now: options.now,
            }));
        }
        if (process.stepNodeIds.length > 0 && process.slaMs === undefined) {
            findings.push(createFinding({
                topologyId: topology.id,
                findingKind: "process_sla_missing",
                severity: "low",
                summary: `Process ${process.id} has executable steps but no SLA.`,
                recommendation: "Set slaMs so runtime delay and process health can be evaluated against an operating target.",
                relatedEntities: [relatedProcess],
                reasonCode: "process_sla_missing",
                now: options.now,
            }));
        }
    }
    const responsibilityScopes = new Set(topology.responsibilities.map((entry) => refKey(entry.scope)));
    for (const system of topology.systems) {
        if (system.criticality !== "critical")
            continue;
        const systemRef = { entityType: "enterprise_system", id: system.id };
        const hasOwner = declaredEdges.some((edge) => edge.relationType === "owns" && refKey(edge.to) === refKey(systemRef));
        const hasAccess = declaredEdges.some((edge) => edge.relationType === "has_access_to" && refKey(edge.to) === refKey(systemRef));
        const hasResponsibility = responsibilityScopes.has(refKey(systemRef));
        if (hasOwner && hasAccess && hasResponsibility)
            continue;
        findings.push(createFinding({
            topologyId: topology.id,
            findingKind: "critical_system_access_gap",
            severity: "critical",
            summary: `Critical system ${system.id} is missing owner, access, or responsibility coverage.`,
            recommendation: "Declare owner, data-domain access, and responsibility matrix coverage before critical system runtime use.",
            relatedEntities: [systemRef],
            reasonCode: "critical_system_operating_model_incomplete",
            detail: {
                hasOwner,
                hasAccess,
                hasResponsibility,
                dataDomainIds: system.dataDomainIds,
            },
            now: options.now,
        }));
    }
    return findings;
}
function dedupeFindings(findings) {
    const byId = new Map();
    for (const finding of findings) {
        if (!byId.has(finding.findingId))
            byId.set(finding.findingId, finding);
    }
    return [...byId.values()].sort((left, right) => {
        const severityOrder = {
            critical: 0,
            high: 1,
            medium: 2,
            low: 3,
            info: 4,
        };
        return severityOrder[left.severity] - severityOrder[right.severity] || left.findingId.localeCompare(right.findingId);
    });
}
function persistFindings(db, findings) {
    if (findings.length === 0)
        return;
    assertMigrationWriteAllowed(db, "topology_gap_findings.upsert");
    const tx = db.transaction(() => {
        for (const finding of findings) {
            db.prepare(`INSERT INTO topology_gap_findings
         (finding_id, topology_id, topology_run_id, finding_kind, severity, status, summary, detail_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(finding_id) DO UPDATE SET
           topology_run_id = excluded.topology_run_id,
           finding_kind = excluded.finding_kind,
           severity = excluded.severity,
           status = excluded.status,
           summary = excluded.summary,
           detail_json = excluded.detail_json,
           updated_at = excluded.updated_at`).run(finding.findingId, finding.topologyId, finding.topologyRunId ?? null, finding.findingKind, finding.severity, finding.status, finding.summary, JSON.stringify({
                recommendation: finding.recommendation,
                relatedEntities: finding.relatedEntities,
                relatedRelations: finding.relatedRelations,
                relatedRuns: finding.relatedRuns,
                detail: finding.detail,
            }), finding.createdAt, finding.updatedAt);
        }
    });
    tx();
}
export function analyzeTopologyGaps(options) {
    const now = options.now ?? Date.now();
    const declaredEdges = buildDeclaredTopologyEdges(options.topology);
    const observedEdges = options.observedEdges ?? extractObservedTopologyEdges({
        ...options,
        topology: options.topology,
        topologyId: options.topology.id,
    });
    const diffs = computeDiffs(options.topology.id, declaredEdges, observedEdges);
    const findings = dedupeFindings([
        ...detectRelationFindings(options.topology, diffs, now),
        ...detectOwnerMismatchFindings(options.topology, declaredEdges, observedEdges, now),
        ...detectStructuralRiskFindings(options.topology, declaredEdges, observedEdges, {
            overloadedNodeThreshold: options.overloadedNodeThreshold ?? 4,
            now,
        }),
        ...detectOrgWorkloadFindings(options.topology, {
            bottleneckThreshold: options.orgWorkloadBottleneckThreshold ?? 1.5,
            now,
        }),
    ]);
    const db = options.db ?? (options.persist === true ? getDb() : undefined);
    if (options.persist === true && db !== undefined)
        persistFindings(db, findings);
    const matchedCount = diffs.filter((diff) => diff.kind === "matched").length;
    const observedOnlyCount = diffs.filter((diff) => diff.kind === "observed_only").length;
    const declaredOnlyCount = diffs.filter((diff) => diff.kind === "declared_only").length;
    const mismatchedCount = diffs.filter((diff) => diff.kind === "mismatched_relation").length;
    const result = {
        topologyId: options.topology.id,
        generatedAt: now,
        declaredEdges,
        observedEdges,
        diffs,
        findings,
        summary: {
            declaredEdgeCount: declaredEdges.length,
            observedEdgeCount: observedEdges.length,
            matchedCount,
            observedOnlyCount,
            declaredOnlyCount,
            mismatchedCount,
            findingCount: findings.length,
            highOrCriticalFindingCount: findings.filter((finding) => HIGH_SEVERITIES.has(finding.severity)).length,
        },
    };
    if (options.topologyRunId !== undefined)
        result.topologyRunId = options.topologyRunId;
    return result;
}
export function listDeclaredTopologyEdges(topology) {
    return buildDeclaredTopologyEdges(topology);
}
function detectOrgWorkloadFindings(topology, options) {
    return projectEnterpriseOrgWorkloadMetrics(topology, {
        bottleneckThreshold: options.bottleneckThreshold,
        asOf: options.now,
    })
        .filter((metric) => metric.bottleneckScore >= options.bottleneckThreshold)
        .map((metric) => createFinding({
        topologyId: topology.id,
        findingKind: "org_workload_bottleneck",
        severity: metric.bottleneckScore >= options.bottleneckThreshold * 2 ? "high" : "medium",
        summary: `OrgUnit ${metric.orgUnitId} workload bottleneck score is ${metric.bottleneckScore}.`,
        recommendation: "Redistribute responsibility, add backup approvers, or split overloaded process nodes.",
        relatedEntities: [{ entityType: "org_unit", id: metric.orgUnitId }],
        reasonCode: "org_workload_bottleneck_score_high",
        detail: {
            metric: {
                topologyId: metric.topologyId,
                orgUnitId: metric.orgUnitId,
                orgUnitName: metric.orgUnitName,
                positionCount: metric.positionCount,
                personCount: metric.personCount,
                activeMembershipCount: metric.activeMembershipCount,
                allocatedPercent: metric.allocatedPercent,
                ownedNodeCount: metric.ownedNodeCount,
                responsibilityCount: metric.responsibilityCount,
                approvalTargetCount: metric.approvalTargetCount,
                processCount: metric.processCount,
                criticalSystemCount: metric.criticalSystemCount,
                workloadScore: metric.workloadScore,
                capacityScore: metric.capacityScore,
                bottleneckScore: metric.bottleneckScore,
                bottleneckReasons: [...metric.bottleneckReasons],
            },
            threshold: options.bottleneckThreshold,
        },
        now: options.now,
    }));
}
//# sourceMappingURL=gap-analysis.js.map