import { describe, expect, it } from "vitest"
import {
  ENTERPRISE_RELATION_TYPES,
  ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
  type EnterpriseTeam,
  type EnterpriseTopology,
  validateEnterpriseRelation,
  validateEnterpriseTeam,
  validateEnterpriseTopology,
  validateNodeContract,
} from "../packages/core/src/contracts/index.ts"
import type { EnterpriseTopology as WebEnterpriseTopology } from "../packages/webui/src/contracts/enterprise-topology.ts"

const now = Date.UTC(2026, 3, 29, 0, 0, 0)

function base(entityType: EnterpriseTopology["entityType"], id: string, name: string) {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType,
    id,
    name,
    status: "draft" as const,
    createdAt: now,
    updatedAt: now,
  }
}

function validTopology(): EnterpriseTopology {
  return {
    ...base("topology", "topology:customer-success", "Customer Success Topology"),
    description: "Minimal enterprise topology for contract validation.",
    nodes: [
      {
        ...base("node", "node:intake", "Intake"),
        nodeType: "function",
        owner: { entityType: "position", id: "position:cs-lead" },
        tags: ["customer-success"],
        children: ["node:triage"],
        template: {
          templateId: "template:generic-work-node",
          source: "system_preset",
          fixedRoleCatalog: false,
        },
        allowedToolIds: ["tool:crm-search"],
        allowedSystemIds: ["system:crm"],
      },
      {
        ...base("node", "node:triage", "Triage"),
        nodeType: "review_node",
        tags: ["triage"],
        children: [],
        allowedToolIds: [],
        allowedSystemIds: [],
      },
    ],
    teams: [
      {
        ...base("team", "team:cs", "Customer Success Team"),
        purpose: "Logical node grouping for coverage.",
        nodeIds: ["node:intake", "node:triage"],
        tags: ["coverage"],
      },
    ],
    orgUnits: [
      {
        ...base("org_unit", "org:customer-success", "Customer Success"),
        positionIds: ["position:cs-lead"],
        personIds: ["person:lee"],
        kpiIds: ["kpi:response-time"],
        responsibilityArea: "Customer response operations.",
      },
    ],
    positions: [
      {
        ...base("position", "position:cs-lead", "CS Lead"),
        orgUnitId: "org:customer-success",
        personIds: ["person:lee"],
        responsibilityIds: ["resp:customer-response"],
      },
    ],
    persons: [
      {
        ...base("person", "person:lee", "Lee"),
        positionIds: ["position:cs-lead"],
        orgUnitIds: ["org:customer-success"],
        availability: "available",
      },
    ],
    memberships: [
      {
        ...base("membership", "membership:lee-cs", "Lee CS membership"),
        personId: "person:lee",
        positionId: "position:cs-lead",
        orgUnitId: "org:customer-success",
      },
    ],
    authorityRules: [],
    responsibilities: [],
    systems: [
      {
        ...base("enterprise_system", "system:crm", "CRM"),
        systemType: "internal",
        dataDomainIds: ["data:customer"],
        criticality: "high",
      },
    ],
    tools: [
      {
        ...base("enterprise_tool", "tool:crm-search", "CRM Search"),
        toolType: "read_only",
        systemId: "system:crm",
      },
    ],
    processes: [],
    relations: [
      {
        ...base("relation", "relation:intake-triage", "Intake delegates to Triage"),
        relationType: "delegates_to",
        from: { entityType: "node", id: "node:intake" },
        to: { entityType: "node", id: "node:triage" },
      },
      {
        ...base("relation", "relation:intake-crm", "Intake uses CRM"),
        relationType: "uses_system",
        from: { entityType: "node", id: "node:intake" },
        to: { entityType: "enterprise_system", id: "system:crm" },
      },
    ],
  }
}

describe("task001 enterprise topology domain contracts", () => {
  it("validates a minimal topology independently from sub-agent config", () => {
    const topology = validTopology()

    const result = validateEnterpriseTopology(topology)

    expect(result.ok).toBe(true)
    const webMirror: WebEnterpriseTopology = topology
    expect(webMirror.entityType).toBe("topology")
  })

  it("returns stable reason codes for missing required fields", () => {
    const topology = validTopology()
    const invalid = {
      ...topology,
      nodes: [{ ...topology.nodes[0], name: "" }],
    }

    const result = validateEnterpriseTopology(invalid)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "$.nodes[0].name",
            reasonCode: "missing_required_field",
          }),
        ]),
      )
    }
  })

  it("rejects team execution semantics", () => {
    const team: EnterpriseTeam & { delegationPolicy: { enabled: boolean } } = {
      ...validTopology().teams[0],
      delegationPolicy: { enabled: true },
    }

    const result = validateEnterpriseTeam(team)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "$.delegationPolicy",
            reasonCode: "team_execution_semantics_forbidden",
          }),
        ]),
      )
    }
  })

  it("rejects Team and OrgUnit field mixing", () => {
    const invalidTeam = {
      ...validTopology().teams[0],
      parentOrgUnitId: "org:customer-success",
    }

    const result = validateEnterpriseTeam(invalidTeam)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "$.parentOrgUnitId",
            reasonCode: "team_org_unit_mixed",
          }),
        ]),
      )
    }
  })

  it("rejects unknown relation types and incompatible endpoints", () => {
    const relation = {
      ...validTopology().relations[0],
      relationType: "parent_child",
    }

    const invalidType = validateEnterpriseRelation(relation)

    expect(invalidType.ok).toBe(false)
    if (!invalidType.ok) {
      expect(invalidType.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "$.relationType",
            reasonCode: "invalid_relation_type",
          }),
        ]),
      )
    }

    const invalidEndpoint = validateEnterpriseRelation({
      ...validTopology().relations[0],
      relationType: "uses_tool",
      to: { entityType: "enterprise_system", id: "system:crm" },
    })

    expect(invalidEndpoint.ok).toBe(false)
    if (!invalidEndpoint.ok) {
      expect(invalidEndpoint.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            reasonCode: "invalid_relation_endpoint",
          }),
        ]),
      )
    }
    expect(ENTERPRISE_RELATION_TYPES).toContain("delegates_to")
    expect(ENTERPRISE_RELATION_TYPES).not.toContain("parent_child")
  })

  it("does not make fixed role agent catalogs part of the source model", () => {
    const topology = {
      ...validTopology(),
      fixedRoleAgentCatalog: ["Planner Agent", "Research Agent", "Validator Agent"],
    }

    const topologyResult = validateEnterpriseTopology(topology)

    expect(topologyResult.ok).toBe(false)
    if (!topologyResult.ok) {
      expect(topologyResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "$.fixedRoleAgentCatalog",
            reasonCode: "fixed_role_catalog_forbidden",
          }),
        ]),
      )
    }

    const nodeResult = validateNodeContract({
      ...validTopology().nodes[0],
      template: {
        templateId: "template:planner",
        source: "system_preset",
        fixedRoleCatalog: true,
      },
    })

    expect(nodeResult.ok).toBe(false)
    if (!nodeResult.ok) {
      expect(nodeResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "$.template.fixedRoleCatalog",
            reasonCode: "fixed_role_catalog_forbidden",
          }),
        ]),
      )
    }
  })
})
