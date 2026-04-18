import crypto from "node:crypto"
import { insertControlEvent } from "../db/index.js"
import type { SourceFreshnessPolicy, WebRetrievalMethod, WebRetrievalPolicyDecision } from "./web-retrieval-policy.js"

export type RetrievalSourceMethod = WebRetrievalMethod | "known_source_adapter" | "ai_assisted_planner"

export type RetrievalSessionStatus =
  | "created"
  | "discovering_sources"
  | "fetching_sources"
  | "extracting_candidates"
  | "verifying_candidates"
  | "planning_next_attempt"
  | "answer_ready"
  | "limited_complete"
  | "blocked"
  | "delivered"

export type RetrievalAttemptStatus = "planned" | "started" | "succeeded" | "failed" | "skipped"

export type RetrievalTargetKind = "unknown" | "finance_index" | "weather_current" | "general_latest" | "general_web"

export interface RetrievalTargetContract {
  targetId: string
  kind: RetrievalTargetKind
  rawQuery?: string | null
  canonicalName?: string | null
  symbols?: string[]
  market?: string | null
  locationName?: string | null
  locale?: string | null
}

export interface RetrievalAttempt {
  id: string
  method: RetrievalSourceMethod
  status: RetrievalAttemptStatus
  dedupeKey: string
  toolName?: string | null
  sourceUrl?: string | null
  sourceDomain?: string | null
  errorKind?: string | null
  stopReason?: string | null
  startedAt: string
  finishedAt?: string | null
  detail?: Record<string, unknown>
}

export interface RetrievalBudget {
  softBudgetMs: number
  hardBudgetMs: number
  searchQueryVariants: number
  distinctSourceDomains: number
  directFetchAttempts: number
  browserSearchAttempts: number
  aiPlannerCalls: number
}

export interface RetrievalSession {
  id: string
  runId?: string | null
  requestGroupId?: string | null
  sessionKey?: string | null
  targetContract: RetrievalTargetContract
  freshnessPolicy: SourceFreshnessPolicy
  status: RetrievalSessionStatus
  budget: RetrievalBudget
  createdAt: string
  updatedAt: string
  attempts: RetrievalAttempt[]
  controlEventIds: string[]
  plannerAvailable: boolean
  plannerUnavailableReason?: string | null
  stopReason?: string | null
}

export interface RetrievalSessionControllerInput {
  id?: string
  runId?: string | null
  requestGroupId?: string | null
  sessionKey?: string | null
  targetContract: RetrievalTargetContract
  freshnessPolicy: SourceFreshnessPolicy
  budget?: Partial<RetrievalBudget>
  plannerAvailable?: boolean
  plannerUnavailableReason?: string | null
  now?: Date
  recordControlEvents?: boolean
}

export interface RecordRetrievalAttemptInput {
  method: RetrievalSourceMethod
  status?: RetrievalAttemptStatus
  dedupeKey?: string
  toolName?: string | null
  sourceUrl?: string | null
  sourceDomain?: string | null
  errorKind?: string | null
  stopReason?: string | null
  detail?: Record<string, unknown>
  now?: Date
}

export interface LimitedCompletionReadiness {
  ok: boolean
  reasons: string[]
  nextMethods: RetrievalSourceMethod[]
}

export interface RetrievalSessionDirective {
  session: RetrievalSession
  nextMethods: RetrievalSourceMethod[]
  limitedCompletion: LimitedCompletionReadiness
  directive: string
}

const DEFAULT_BUDGET: RetrievalBudget = {
  softBudgetMs: 20_000,
  hardBudgetMs: 45_000,
  searchQueryVariants: 3,
  distinctSourceDomains: 4,
  directFetchAttempts: 6,
  browserSearchAttempts: 2,
  aiPlannerCalls: 2,
}

const TRACKING_QUERY_KEYS = new Set([
  "fbclid",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "utm_campaign",
  "utm_content",
  "utm_medium",
  "utm_source",
  "utm_term",
])

function iso(now: Date): string {
  return now.toISOString()
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "null"
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, nested]) => nested !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
  return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`).join(",")}}`
}

function hash(value: unknown): string {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 24)
}

function normalizeText(value: string | null | undefined): string {
  return value?.trim().replace(/\s+/g, " ") ?? ""
}

function canonicalSourceUrl(url: string | null | undefined): { href: string | null; domain: string | null } {
  if (!url) return { href: null, domain: null }
  try {
    const parsed = new URL(url.trim())
    parsed.hash = ""
    parsed.hostname = parsed.hostname.toLowerCase()
    const canonical = new URL(`${parsed.protocol}//${parsed.host}${parsed.pathname}`)
    const entries = [...parsed.searchParams.entries()]
      .filter(([key]) => !TRACKING_QUERY_KEYS.has(key.toLowerCase()))
      .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue))
    for (const [key, value] of entries) canonical.searchParams.append(key, value)
    return { href: canonical.toString(), domain: canonical.hostname }
  } catch {
    const fallback = normalizeText(url)
    return { href: fallback || null, domain: null }
  }
}

function sourceDomainFromUrl(url: string | null | undefined): string | null {
  return canonicalSourceUrl(url).domain
}

function methodStage(method: RetrievalSourceMethod): RetrievalSessionStatus {
  switch (method) {
    case "fast_text_search": return "discovering_sources"
    case "official_api":
    case "direct_fetch":
    case "browser_search":
    case "known_source_adapter": return "fetching_sources"
    case "ai_assisted_planner": return "planning_next_attempt"
  }
}

function isLatestLike(policy: SourceFreshnessPolicy): boolean {
  return policy === "latest_approximate"
}

export function createRetrievalTargetContract(input: {
  kind?: RetrievalTargetKind
  rawQuery?: string | null
  canonicalName?: string | null
  symbols?: string[]
  market?: string | null
  locationName?: string | null
  locale?: string | null
}): RetrievalTargetContract {
  const normalized = {
    kind: input.kind ?? "unknown",
    rawQuery: normalizeText(input.rawQuery) || null,
    canonicalName: normalizeText(input.canonicalName) || null,
    symbols: input.symbols?.map((symbol) => normalizeText(symbol)).filter(Boolean).sort() ?? [],
    market: normalizeText(input.market) || null,
    locationName: normalizeText(input.locationName) || null,
    locale: normalizeText(input.locale) || null,
  }
  return {
    targetId: `target:${hash(normalized)}`,
    kind: normalized.kind,
    rawQuery: normalized.rawQuery,
    canonicalName: normalized.canonicalName,
    symbols: normalized.symbols,
    market: normalized.market,
    locationName: normalized.locationName,
    locale: normalized.locale,
  }
}

export function buildRetrievalDedupeKey(input: {
  method: RetrievalSourceMethod
  freshnessPolicy: SourceFreshnessPolicy
  query?: string | null
  sourceUrl?: string | null
  sourceDomain?: string | null
  params?: Record<string, unknown> | null
}): string {
  const canonicalUrl = canonicalSourceUrl(input.sourceUrl)
  return `retrieval:${input.method}:${hash({
    freshnessPolicy: input.freshnessPolicy,
    query: normalizeText(input.query).toLocaleLowerCase("ko-KR") || null,
    sourceUrl: canonicalUrl.href,
    sourceDomain: normalizeText(input.sourceDomain).toLocaleLowerCase("en-US") || canonicalUrl.domain,
    params: input.params ?? null,
  })}`
}

export function defaultRetrievalBudget(input: Partial<RetrievalBudget> = {}): RetrievalBudget {
  return { ...DEFAULT_BUDGET, ...input }
}

export function defaultSourceLadder(_target: RetrievalTargetContract, freshnessPolicy: SourceFreshnessPolicy): RetrievalSourceMethod[] {
  if (freshnessPolicy === "strict_timestamp") {
    return ["fast_text_search", "direct_fetch", "known_source_adapter", "browser_search", "ai_assisted_planner"]
  }
  return ["fast_text_search", "direct_fetch", "browser_search", "known_source_adapter", "ai_assisted_planner"]
}

export class RetrievalSessionController {
  private session: RetrievalSession
  private readonly recordControlEvents: boolean

  constructor(input: RetrievalSessionControllerInput) {
    const now = iso(input.now ?? new Date())
    this.recordControlEvents = input.recordControlEvents ?? false
    this.session = {
      id: input.id ?? `retrieval:${hash({ runId: input.runId ?? null, requestGroupId: input.requestGroupId ?? null, target: input.targetContract })}`,
      runId: input.runId ?? null,
      requestGroupId: input.requestGroupId ?? null,
      sessionKey: input.sessionKey ?? null,
      targetContract: input.targetContract,
      freshnessPolicy: input.freshnessPolicy,
      status: "created",
      budget: defaultRetrievalBudget(input.budget),
      createdAt: now,
      updatedAt: now,
      attempts: [],
      controlEventIds: [],
      plannerAvailable: input.plannerAvailable ?? false,
      plannerUnavailableReason: input.plannerUnavailableReason ?? (input.plannerAvailable ? null : "not_implemented_task004"),
    }
    this.recordEvent("web_retrieval.session.created", "retrieval session created", { status: this.session.status })
  }

  snapshot(): RetrievalSession {
    return {
      ...this.session,
      targetContract: { ...this.session.targetContract, symbols: [...(this.session.targetContract.symbols ?? [])] },
      budget: { ...this.session.budget },
      attempts: this.session.attempts.map((attempt) => ({
        ...attempt,
        ...(attempt.detail ? { detail: { ...attempt.detail } } : {}),
      })),
      controlEventIds: [...this.session.controlEventIds],
    }
  }

  canAttempt(dedupeKey: string): boolean {
    return !this.session.attempts.some((attempt) => attempt.dedupeKey === dedupeKey)
  }

  transition(status: RetrievalSessionStatus, reason: string, detail: Record<string, unknown> = {}, now = new Date()): RetrievalSession {
    if (status === "limited_complete" && this.session.attempts.length === 0) {
      throw new Error("Cannot transition retrieval session to limited_complete without at least one attempt")
    }
    if (status === "answer_ready" && this.session.attempts.length === 0) {
      throw new Error("Cannot transition retrieval session to answer_ready without evidence attempts")
    }
    const previousStatus = this.session.status
    this.session = {
      ...this.session,
      status,
      updatedAt: iso(now),
      ...(status === "limited_complete" || status === "blocked" ? { stopReason: reason } : {}),
    }
    this.recordEvent("web_retrieval.session.transition", `retrieval session ${previousStatus} -> ${status}`, {
      previousStatus,
      nextStatus: status,
      reason,
      ...detail,
    })
    return this.snapshot()
  }

  recordAttempt(input: RecordRetrievalAttemptInput): RetrievalAttempt {
    const now = input.now ?? new Date()
    const sourceDomain = input.sourceDomain ?? sourceDomainFromUrl(input.sourceUrl)
    const dedupeKey = input.dedupeKey ?? buildRetrievalDedupeKey({
      method: input.method,
      freshnessPolicy: this.session.freshnessPolicy,
      sourceUrl: input.sourceUrl ?? null,
      sourceDomain,
      params: input.detail ?? null,
    })

    if (!this.canAttempt(dedupeKey)) {
      const skipped: RetrievalAttempt = {
        id: `attempt:${hash({ dedupeKey, skippedAt: iso(now), sessionId: this.session.id })}`,
        method: input.method,
        status: "skipped",
        dedupeKey,
        toolName: input.toolName ?? null,
        sourceUrl: input.sourceUrl ?? null,
        sourceDomain,
        errorKind: "duplicate_attempt",
        stopReason: "dedupe_suppressed",
        startedAt: iso(now),
        finishedAt: iso(now),
        ...(input.detail ? { detail: input.detail } : {}),
      }
      this.session = { ...this.session, attempts: [...this.session.attempts, skipped], updatedAt: iso(now) }
      this.recordEvent("web_retrieval.attempt.skipped", `${input.method} duplicate attempt skipped`, { dedupeKey, method: input.method })
      return skipped
    }

    const status = input.status ?? "started"
    const attempt: RetrievalAttempt = {
      id: `attempt:${hash({ dedupeKey, startedAt: iso(now), sessionId: this.session.id })}`,
      method: input.method,
      status,
      dedupeKey,
      toolName: input.toolName ?? null,
      sourceUrl: input.sourceUrl ?? null,
      sourceDomain,
      errorKind: input.errorKind ?? null,
      stopReason: input.stopReason ?? null,
      startedAt: iso(now),
      finishedAt: status === "succeeded" || status === "failed" || status === "skipped" ? iso(now) : null,
      ...(input.detail ? { detail: input.detail } : {}),
    }
    this.session = { ...this.session, attempts: [...this.session.attempts, attempt], updatedAt: iso(now) }
    this.transition(methodStage(input.method), `${input.method} attempt recorded`, { attemptId: attempt.id, status }, now)
    this.recordEvent("web_retrieval.attempt.recorded", `${input.method} attempt ${status}`, {
      attemptId: attempt.id,
      method: input.method,
      status,
      dedupeKey,
      sourceDomain,
    })
    return attempt
  }

  nextMethods(): RetrievalSourceMethod[] {
    return getNextRetrievalMethods(this.session)
  }

  limitedCompletionReadiness(): LimitedCompletionReadiness {
    return evaluateLimitedCompletionReadiness(this.session)
  }

  isRecoverable(): boolean {
    return isRetrievalSessionRecoverable(this.session)
  }

  private recordEvent(eventType: string, summary: string, detail: Record<string, unknown>): string | null {
    if (!this.recordControlEvents) return null
    try {
      const id = insertControlEvent({
        eventType,
        correlationId: this.session.id,
        runId: this.session.runId ?? null,
        requestGroupId: this.session.requestGroupId ?? null,
        sessionKey: this.session.sessionKey ?? null,
        component: "web_retrieval",
        severity: "info",
        summary,
        detail: {
          retrievalSessionId: this.session.id,
          freshnessPolicy: this.session.freshnessPolicy,
          targetId: this.session.targetContract.targetId,
          ...detail,
        },
      })
      this.session = { ...this.session, controlEventIds: [...this.session.controlEventIds, id] }
      return id
    } catch {
      return null
    }
  }
}

export function createRetrievalSessionController(input: RetrievalSessionControllerInput): RetrievalSessionController {
  return new RetrievalSessionController(input)
}

export function getNextRetrievalMethods(session: RetrievalSession): RetrievalSourceMethod[] {
  if (session.status === "answer_ready" || session.status === "delivered" || session.status === "blocked") return []

  const attempted = new Set(session.attempts.filter((attempt) => attempt.status !== "skipped").map((attempt) => attempt.method))
  const ladder = defaultSourceLadder(session.targetContract, session.freshnessPolicy)
  const next = ladder.filter((method) => {
    if (method === "ai_assisted_planner" && !session.plannerAvailable) return false
    return !attempted.has(method)
  })
  return next.slice(0, 2)
}

export function evaluateLimitedCompletionReadiness(session: RetrievalSession): LimitedCompletionReadiness {
  const effectiveAttempts = session.attempts.filter((attempt) => attempt.status !== "skipped")
  const methods = new Set(effectiveAttempts.map((attempt) => attempt.method))
  const reasons: string[] = []

  if (effectiveAttempts.length === 0) reasons.push("no_attempts")
  if (isLatestLike(session.freshnessPolicy) && methods.has("fast_text_search") && !methods.has("direct_fetch") && !methods.has("known_source_adapter") && !methods.has("browser_search")) {
    reasons.push("direct_fetch_or_known_adapter_required_after_search")
  }
  if (isLatestLike(session.freshnessPolicy) && methods.size < 2 && !methods.has("known_source_adapter")) {
    reasons.push("source_method_diversity_required")
  }
  if (session.plannerAvailable && !methods.has("ai_assisted_planner")) {
    reasons.push("ai_assisted_planner_required_or_explicitly_unavailable")
  }

  return {
    ok: reasons.length === 0,
    reasons,
    nextMethods: getNextRetrievalMethods(session),
  }
}

export function isRetrievalSessionRecoverable(session: RetrievalSession): boolean {
  if (session.status === "blocked" || session.status === "delivered" || session.status === "answer_ready") return false
  return getNextRetrievalMethods(session).length > 0 || !evaluateLimitedCompletionReadiness(session).ok
}

export function buildRetrievalSessionDirective(input: {
  policy: WebRetrievalPolicyDecision
  targetContract: RetrievalTargetContract
  method?: RetrievalSourceMethod
  sourceUrl?: string | null
  sourceDomain?: string | null
  runId?: string | null
  requestGroupId?: string | null
  sessionKey?: string | null
  plannerAvailable?: boolean
}): RetrievalSessionDirective {
  const controller = createRetrievalSessionController({
    runId: input.runId ?? null,
    requestGroupId: input.requestGroupId ?? null,
    sessionKey: input.sessionKey ?? null,
    targetContract: input.targetContract,
    freshnessPolicy: input.policy.freshnessPolicy,
    plannerAvailable: input.plannerAvailable ?? false,
    plannerUnavailableReason: input.plannerAvailable ? null : "not_implemented_task004",
  })
  controller.recordAttempt({
    method: input.method ?? input.policy.method,
    status: "succeeded",
    dedupeKey: input.policy.dedupeKey,
    sourceUrl: input.sourceUrl ?? null,
    sourceDomain: input.sourceDomain ?? null,
    detail: { canonicalParams: input.policy.canonicalParams },
  })
  const limitedCompletion = controller.limitedCompletionReadiness()
  const nextMethods = controller.nextMethods()
  const directive = limitedCompletion.ok
    ? "Retrieval minimum attempt conditions are satisfied. Completion still requires verification evidence before final answer."
    : `Do not finish as value-not-found yet. Required next retrieval methods: ${nextMethods.join(", ") || "none"}. Missing conditions: ${limitedCompletion.reasons.join(", ")}.`
  return { session: controller.snapshot(), nextMethods, limitedCompletion, directive }
}

export function createGenericTargetFromPolicy(input: {
  policy: WebRetrievalPolicyDecision
  query?: string | null
  url?: string | null
  locale?: string | null
}): RetrievalTargetContract {
  const rawQuery = input.query ?? input.url ?? JSON.stringify(input.policy.canonicalParams)
  const kind: RetrievalTargetKind = input.policy.freshnessPolicy === "latest_approximate" ? "general_latest" : "general_web"
  return createRetrievalTargetContract({ kind, rawQuery, locale: input.locale ?? null })
}
