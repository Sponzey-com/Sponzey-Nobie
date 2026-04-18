import crypto from "node:crypto"
import { createRetrievalTargetContract, type RetrievalTargetContract } from "./web-retrieval-session.js"

export interface WebLocationContract {
  locationId: string
  locationName: string
  adminArea: string
  country: string
  latitude?: number | null
  longitude?: number | null
  fallbackRegion?: string | null
  hierarchy: string[]
}

export interface WebLocationResolution {
  contract: WebLocationContract
  targetContract: RetrievalTargetContract
  caveats: string[]
}

function stableLocationId(input: Omit<WebLocationContract, "locationId">): string {
  return `loc:${crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 16)}`
}

function normalizeText(value: string | null | undefined): string {
  return value?.trim().replace(/\s+/g, " ") ?? ""
}

function normalizeForLookup(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[^\p{L}\p{N}]+/gu, "")
}

export function createWebLocationContract(input: {
  locationName: string
  adminArea: string
  country?: string
  latitude?: number | null
  longitude?: number | null
  fallbackRegion?: string | null
  hierarchy?: string[]
}): WebLocationContract {
  const base = {
    locationName: normalizeText(input.locationName),
    adminArea: normalizeText(input.adminArea),
    country: normalizeText(input.country) || "KR",
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    fallbackRegion: normalizeText(input.fallbackRegion) || null,
    hierarchy: (input.hierarchy ?? [input.locationName, input.adminArea, input.country ?? "KR"]).map(normalizeText).filter(Boolean),
  }
  return { locationId: stableLocationId(base), ...base }
}

export function createWeatherTargetContract(location: WebLocationContract, rawQuery?: string | null): RetrievalTargetContract {
  return createRetrievalTargetContract({
    kind: "weather_current",
    rawQuery: rawQuery ?? `${location.locationName} 날씨`,
    locationName: location.locationName,
    canonicalName: `${location.locationName} weather`,
    locale: "ko-KR",
  })
}

export function resolveWeatherLocationContract(query: string): WebLocationResolution | null {
  const normalized = normalizeForLookup(query)
  if (!normalized) return null
  let contract: WebLocationContract | null = null
  const caveats: string[] = []
  if (normalized.includes("동천동")) {
    contract = createWebLocationContract({
      locationName: "동천동",
      adminArea: "수지구 용인시 경기도",
      country: "KR",
      fallbackRegion: "수지구",
      hierarchy: ["동천동", "수지구", "용인시", "경기도", "대한민국"],
    })
  } else if (normalized.includes("수지구")) {
    contract = createWebLocationContract({
      locationName: "수지구",
      adminArea: "용인시 경기도",
      country: "KR",
      fallbackRegion: "용인시",
      hierarchy: ["수지구", "용인시", "경기도", "대한민국"],
    })
  } else if (normalized.includes("용인")) {
    contract = createWebLocationContract({
      locationName: "용인시",
      adminArea: "경기도",
      country: "KR",
      fallbackRegion: "경기도",
      hierarchy: ["용인시", "경기도", "대한민국"],
    })
  }
  if (!contract) return null
  if (contract.fallbackRegion) caveats.push(`fallback_region_available:${contract.fallbackRegion}`)
  return { contract, targetContract: createWeatherTargetContract(contract, query), caveats }
}

export function locationHierarchyContains(location: WebLocationContract, label: string): boolean {
  const normalizedLabel = normalizeForLookup(label)
  return location.hierarchy.some((item) => normalizeForLookup(item) === normalizedLabel)
}
