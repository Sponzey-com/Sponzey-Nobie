import { type RetrievalTargetContract } from "./web-retrieval-session.js";
export interface WebLocationContract {
    locationId: string;
    locationName: string;
    adminArea: string;
    country: string;
    latitude?: number | null;
    longitude?: number | null;
    fallbackRegion?: string | null;
    hierarchy: string[];
}
export interface WebLocationResolution {
    contract: WebLocationContract;
    targetContract: RetrievalTargetContract;
    caveats: string[];
}
export declare function createWebLocationContract(input: {
    locationName: string;
    adminArea: string;
    country?: string;
    latitude?: number | null;
    longitude?: number | null;
    fallbackRegion?: string | null;
    hierarchy?: string[];
}): WebLocationContract;
export declare function createWeatherTargetContract(location: WebLocationContract, rawQuery?: string | null): RetrievalTargetContract;
export declare function resolveWeatherLocationContract(query: string): WebLocationResolution | null;
export declare function locationHierarchyContains(location: WebLocationContract, label: string): boolean;
//# sourceMappingURL=web-location-contract.d.ts.map