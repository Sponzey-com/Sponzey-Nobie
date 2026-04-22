export type OrchestrationEntityKind = "agent" | "team"

export interface GenerateOrchestrationEntityIdInput {
  kind: OrchestrationEntityKind
  displayName?: string
  nickname?: string
  existingIds?: Iterable<string>
  draftIds?: Iterable<string>
  suffixLength?: number
  maxAttempts?: number
  randomSuffix?: () => string
}

export const ORCHESTRATION_ID_PREFIX: Record<OrchestrationEntityKind, string> = {
  agent: "agent",
  team: "team",
}

const DEFAULT_SUFFIX_LENGTH = 4
const DEFAULT_MAX_ATTEMPTS = 32
const MAX_ID_LENGTH = 64

export function slugifyOrchestrationSegment(value: string, fallback: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return normalized || fallback
}

export function isLegacyOrchestrationId(value: string): boolean {
  return /^(agent|team):[^:\s]+$/i.test(value.trim())
}

export function isOrchestrationEntityId(value: string, kind?: OrchestrationEntityKind): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (kind) {
    return new RegExp(`^${ORCHESTRATION_ID_PREFIX[kind]}-[a-z0-9]+(?:-[a-z0-9]+)*$`).test(trimmed)
  }
  return /^(agent|team)-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed)
}

export function generateOrchestrationEntityId(input: GenerateOrchestrationEntityIdInput): string {
  const suffixLength = clampSuffixLength(input.suffixLength ?? DEFAULT_SUFFIX_LENGTH)
  const fallbackSlug = input.kind
  const slugSeed = [input.displayName, input.nickname].find((item) => item?.trim()) ?? fallbackSlug
  const occupied = new Set<string>()
  for (const entry of input.existingIds ?? []) occupied.add(entry.trim())
  for (const entry of input.draftIds ?? []) occupied.add(entry.trim())
  const randomSuffix = input.randomSuffix ?? defaultRandomSuffix
  const slug = trimSlugToFit(input.kind, slugifyOrchestrationSegment(slugSeed, fallbackSlug), suffixLength)

  for (let attempt = 0; attempt < (input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS); attempt += 1) {
    const suffix = normalizeSuffix(randomSuffix(), suffixLength) || fallbackSuffix(attempt, suffixLength)
    const candidate = buildOrchestrationEntityId(input.kind, slug, suffix)
    if (!occupied.has(candidate)) return candidate
  }

  throw new Error(`Unable to generate unique ${input.kind} id after ${input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS} attempts.`)
}

export function buildOrchestrationEntityId(kind: OrchestrationEntityKind, slug: string, suffix: string): string {
  const prefix = ORCHESTRATION_ID_PREFIX[kind]
  const normalizedSlug = trimSlugToFit(kind, slugifyOrchestrationSegment(slug, kind), suffix.length)
  const normalizedSuffix = normalizeSuffix(suffix, suffix.length) || fallbackSuffix(0, suffix.length)
  return `${prefix}-${normalizedSlug}-${normalizedSuffix}`
}

function trimSlugToFit(kind: OrchestrationEntityKind, slug: string, suffixLength: number): string {
  const prefix = ORCHESTRATION_ID_PREFIX[kind]
  const maxSlugLength = Math.max(1, MAX_ID_LENGTH - prefix.length - suffixLength - 2)
  return slug.slice(0, maxSlugLength).replace(/-+$/g, "") || kind
}

function clampSuffixLength(length: number): number {
  return Math.min(6, Math.max(4, Math.floor(length)))
}

function normalizeSuffix(value: string, length: number): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, length)
}

function fallbackSuffix(attempt: number, length: number): string {
  const raw = (attempt + 1).toString(36).padStart(length, "0")
  return raw.slice(-length)
}

function defaultRandomSuffix(): string {
  return Math.random().toString(36).slice(2, 8)
}
