import type { FastifyInstance, FastifyReply } from "fastify"
import type { JsonObject } from "../../contracts/index.js"
import type {
  DataExchangePackage,
  DataExchangeRetentionPolicy,
  OwnerScope,
} from "../../contracts/sub-agent-orchestration.js"
import {
  type CreateDataExchangePackageInput,
  MemoryIsolationError,
  buildDataExchangeAdminRawView,
  buildDataExchangeSanitizedView,
  createDataExchangePackage,
  getDataExchangePackage,
  listActiveDataExchangePackagesForRecipient,
  listActiveDataExchangePackagesForSource,
  persistDataExchangePackage,
  validateDataExchangePackage,
} from "../../memory/isolation.js"
import { authMiddleware } from "../middleware/auth.js"

type DataExchangeQuery = {
  requesterOwnerType?: string
  requesterOwnerId?: string
  recipientOwnerType?: string
  recipientOwnerId?: string
  sourceOwnerType?: string
  sourceOwnerId?: string
  allowedUse?: DataExchangePackage["allowedUse"]
  includeExpired?: string
  limit?: string
}

type AdminRawQuery = {
  admin?: string
  reason?: string
  requester?: string
}

const OWNER_TYPES = new Set<OwnerScope["ownerType"]>(["nobie", "sub_agent", "team", "system"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function optionalNumberOrNull(value: unknown): number | null | undefined {
  if (value === null) return null
  if (typeof value === "number" && Number.isFinite(value)) return value
  return undefined
}

function parseLimit(value: unknown): number | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  return Math.max(1, Math.min(500, Math.floor(parsed)))
}

function ownerFromRecord(value: unknown): OwnerScope | undefined {
  if (!isRecord(value)) return undefined
  const ownerType = value.ownerType
  const ownerId = value.ownerId
  if (typeof ownerType !== "string" || !OWNER_TYPES.has(ownerType as OwnerScope["ownerType"])) {
    return undefined
  }
  if (typeof ownerId !== "string" || !ownerId.trim()) return undefined
  return { ownerType: ownerType as OwnerScope["ownerType"], ownerId: ownerId.trim() }
}

function ownerFromQuery(
  query: DataExchangeQuery,
  prefix: "requester" | "recipient" | "source",
): OwnerScope | undefined {
  const ownerType = query[`${prefix}OwnerType`]
  const ownerId = query[`${prefix}OwnerId`]
  if (!ownerType || !ownerId || !OWNER_TYPES.has(ownerType as OwnerScope["ownerType"]))
    return undefined
  return { ownerType: ownerType as OwnerScope["ownerType"], ownerId: ownerId.trim() }
}

function sameOwner(left: OwnerScope, right: OwnerScope): boolean {
  return left.ownerType === right.ownerType && left.ownerId === right.ownerId
}

function requesterCanRead(
  requester: OwnerScope | undefined,
  exchange: DataExchangePackage,
): boolean {
  if (!requester) return true
  return sameOwner(requester, exchange.sourceOwner) || sameOwner(requester, exchange.recipientOwner)
}

function requesterCanQuery(
  requester: OwnerScope | undefined,
  sourceOwner: OwnerScope | undefined,
  recipientOwner: OwnerScope | undefined,
): boolean {
  if (!requester) return true
  return Boolean(
    (sourceOwner && sameOwner(requester, sourceOwner)) ||
      (recipientOwner && sameOwner(requester, recipientOwner)),
  )
}

function sendFailure(reply: FastifyReply, statusCode: number, reasonCode: string): FastifyReply {
  return reply.status(statusCode).send({
    ok: false,
    error: reasonCode,
    reasonCode,
  })
}

function normalizeCreateInput(body: unknown): CreateDataExchangePackageInput | undefined {
  if (!isRecord(body)) return undefined
  const sourceOwner = ownerFromRecord(body.sourceOwner)
  const recipientOwner = ownerFromRecord(body.recipientOwner)
  if (!sourceOwner || !recipientOwner || !isJsonObject(body.payload)) return undefined
  const provenanceRefs = Array.isArray(body.provenanceRefs)
    ? body.provenanceRefs.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0,
      )
    : []
  const expiresAt = optionalNumberOrNull(body.expiresAt)
  const sourceNicknameSnapshot = optionalString(body.sourceNicknameSnapshot)
  const recipientNicknameSnapshot = optionalString(body.recipientNicknameSnapshot)
  const parentRunId = optionalString(body.parentRunId)
  const parentSessionId = optionalString(body.parentSessionId)
  const parentSubSessionId = optionalString(body.parentSubSessionId)
  const parentRequestId = optionalString(body.parentRequestId)
  const auditCorrelationId = optionalString(body.auditCorrelationId)
  const exchangeId = optionalString(body.exchangeId)
  const idempotencyKey = optionalString(body.idempotencyKey)
  return {
    sourceOwner,
    recipientOwner,
    ...(sourceNicknameSnapshot ? { sourceNicknameSnapshot } : {}),
    ...(recipientNicknameSnapshot ? { recipientNicknameSnapshot } : {}),
    purpose: optionalString(body.purpose) ?? "",
    allowedUse: body.allowedUse as DataExchangePackage["allowedUse"],
    retentionPolicy: body.retentionPolicy as DataExchangeRetentionPolicy,
    redactionState: body.redactionState as DataExchangePackage["redactionState"],
    provenanceRefs,
    payload: body.payload,
    ...(parentRunId ? { parentRunId } : {}),
    ...(parentSessionId ? { parentSessionId } : {}),
    ...(parentSubSessionId ? { parentSubSessionId } : {}),
    ...(parentRequestId ? { parentRequestId } : {}),
    ...(auditCorrelationId ? { auditCorrelationId } : {}),
    ...(exchangeId ? { exchangeId } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  }
}

export function registerDataExchangeRoutes(app: FastifyInstance): void {
  app.post<{ Body: unknown }>(
    "/api/data-exchanges",
    { preHandler: authMiddleware },
    async (req, reply) => {
      const input = normalizeCreateInput(req.body)
      if (!input) return sendFailure(reply, 400, "invalid_data_exchange_input")
      try {
        const exchange = createDataExchangePackage(input)
        const validation = validateDataExchangePackage(exchange)
        if (!validation.ok) {
          return reply.status(400).send({
            ok: false,
            reasonCode: "data_exchange_validation_failed",
            issues: validation.issues,
          })
        }
        const inserted = persistDataExchangePackage(exchange)
        return reply.status(inserted ? 201 : 200).send({
          ok: true,
          inserted,
          exchange: buildDataExchangeSanitizedView(exchange),
        })
      } catch (error) {
        if (error instanceof MemoryIsolationError) {
          return sendFailure(reply, 400, error.reasonCode)
        }
        throw error
      }
    },
  )

  app.get<{ Querystring: DataExchangeQuery }>(
    "/api/data-exchanges",
    { preHandler: authMiddleware },
    async (req, reply) => {
      const requester = ownerFromQuery(req.query, "requester")
      const recipientOwner = ownerFromQuery(req.query, "recipient")
      const sourceOwner = ownerFromQuery(req.query, "source")
      if (!recipientOwner && !sourceOwner) {
        return sendFailure(reply, 400, "data_exchange_owner_filter_required")
      }
      if (!requesterCanQuery(requester, sourceOwner, recipientOwner)) {
        return sendFailure(reply, 403, "data_exchange_query_forbidden")
      }
      const limit = parseLimit(req.query.limit)
      const now = Date.now()
      const packages = sourceOwner
        ? listActiveDataExchangePackagesForSource(sourceOwner, {
            ...(recipientOwner ? { recipientOwner } : {}),
            ...(limit ? { limit } : {}),
            now,
          })
        : listActiveDataExchangePackagesForRecipient(recipientOwner as OwnerScope, {
            ...(req.query.allowedUse ? { allowedUse: req.query.allowedUse } : {}),
            ...(limit ? { limit } : {}),
            now,
          })
      return {
        ok: true,
        exchanges: packages.map((exchange) => buildDataExchangeSanitizedView(exchange, { now })),
      }
    },
  )

  app.get<{
    Params: { exchangeId: string }
    Querystring: DataExchangeQuery
  }>("/api/data-exchanges/:exchangeId", { preHandler: authMiddleware }, async (req, reply) => {
    const exchange = getDataExchangePackage(req.params.exchangeId, {
      includeExpired: req.query.includeExpired === "true",
    })
    if (!exchange) return sendFailure(reply, 404, "data_exchange_not_found")
    const requester = ownerFromQuery(req.query, "requester")
    if (!requesterCanRead(requester, exchange)) {
      return sendFailure(reply, 403, "data_exchange_read_forbidden")
    }
    return {
      ok: true,
      exchange: buildDataExchangeSanitizedView(exchange),
    }
  })

  app.get<{
    Params: { exchangeId: string }
    Querystring: AdminRawQuery
  }>(
    "/api/data-exchanges/:exchangeId/admin-raw",
    { preHandler: authMiddleware },
    async (req, reply) => {
      const exchange = getDataExchangePackage(req.params.exchangeId, { includeExpired: true })
      if (!exchange) return sendFailure(reply, 404, "data_exchange_not_found")
      const view = buildDataExchangeAdminRawView(exchange, {
        adminAccessGranted: req.query.admin === "true",
        ...(req.query.reason ? { reason: req.query.reason } : {}),
        ...(req.query.requester ? { requester: req.query.requester } : {}),
      })
      if (!view.ok) {
        return sendFailure(
          reply,
          view.reasonCode === "admin_raw_access_reason_required" ? 400 : 403,
          view.reasonCode ?? "admin_raw_access_denied",
        )
      }
      return {
        ok: true,
        adminRawView: view,
      }
    },
  )
}
