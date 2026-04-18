import crypto from "node:crypto";
import { createRetrievalTargetContract } from "./web-retrieval-session.js";
function stableLocationId(input) {
    return `loc:${crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 16)}`;
}
function normalizeText(value) {
    return value?.trim().replace(/\s+/g, " ") ?? "";
}
function normalizeForLookup(value) {
    return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[^\p{L}\p{N}]+/gu, "");
}
export function createWebLocationContract(input) {
    const base = {
        locationName: normalizeText(input.locationName),
        adminArea: normalizeText(input.adminArea),
        country: normalizeText(input.country) || "KR",
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        fallbackRegion: normalizeText(input.fallbackRegion) || null,
        hierarchy: (input.hierarchy ?? [input.locationName, input.adminArea, input.country ?? "KR"]).map(normalizeText).filter(Boolean),
    };
    return { locationId: stableLocationId(base), ...base };
}
export function createWeatherTargetContract(location, rawQuery) {
    return createRetrievalTargetContract({
        kind: "weather_current",
        rawQuery: rawQuery ?? `${location.locationName} 날씨`,
        locationName: location.locationName,
        canonicalName: `${location.locationName} weather`,
        locale: "ko-KR",
    });
}
export function resolveWeatherLocationContract(query) {
    const normalized = normalizeForLookup(query);
    if (!normalized)
        return null;
    let contract = null;
    const caveats = [];
    if (normalized.includes("동천동")) {
        contract = createWebLocationContract({
            locationName: "동천동",
            adminArea: "수지구 용인시 경기도",
            country: "KR",
            fallbackRegion: "수지구",
            hierarchy: ["동천동", "수지구", "용인시", "경기도", "대한민국"],
        });
    }
    else if (normalized.includes("수지구")) {
        contract = createWebLocationContract({
            locationName: "수지구",
            adminArea: "용인시 경기도",
            country: "KR",
            fallbackRegion: "용인시",
            hierarchy: ["수지구", "용인시", "경기도", "대한민국"],
        });
    }
    else if (normalized.includes("용인")) {
        contract = createWebLocationContract({
            locationName: "용인시",
            adminArea: "경기도",
            country: "KR",
            fallbackRegion: "경기도",
            hierarchy: ["용인시", "경기도", "대한민국"],
        });
    }
    if (!contract)
        return null;
    if (contract.fallbackRegion)
        caveats.push(`fallback_region_available:${contract.fallbackRegion}`);
    return { contract, targetContract: createWeatherTargetContract(contract, query), caveats };
}
export function locationHierarchyContains(location, label) {
    const normalizedLabel = normalizeForLookup(label);
    return location.hierarchy.some((item) => normalizeForLookup(item) === normalizedLabel);
}
//# sourceMappingURL=web-location-contract.js.map