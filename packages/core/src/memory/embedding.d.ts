/**
 * Embedding providers for vector memory search.
 * Gracefully degrades to no-op if provider unavailable.
 */
export interface EmbeddingProvider {
    readonly providerId: "none" | "ollama" | "voyage" | "openai";
    readonly modelId: string;
    embed(text: string): Promise<number[]>;
    batchEmbed(texts: string[]): Promise<number[][]>;
    dimensions: number;
}
export declare class NullEmbeddingProvider implements EmbeddingProvider {
    readonly providerId: "none";
    readonly modelId = "none";
    readonly dimensions = 0;
    embed(): Promise<number[]>;
    batchEmbed(texts: string[]): Promise<number[][]>;
}
export declare class OllamaEmbeddingProvider implements EmbeddingProvider {
    readonly providerId: "ollama";
    readonly dimensions: number;
    private baseUrl;
    private model;
    get modelId(): string;
    constructor(opts?: {
        baseUrl?: string;
        model?: string;
        dimensions?: number;
    });
    embed(text: string): Promise<number[]>;
    batchEmbed(texts: string[]): Promise<number[][]>;
}
export declare class VoyageEmbeddingProvider implements EmbeddingProvider {
    readonly providerId: "voyage";
    readonly dimensions: number;
    private apiKey;
    private model;
    get modelId(): string;
    constructor(opts: {
        apiKey: string;
        model?: string;
        dimensions?: number;
    });
    embed(text: string): Promise<number[]>;
    batchEmbed(texts: string[]): Promise<number[][]>;
}
export declare class OpenAIEmbeddingProvider implements EmbeddingProvider {
    readonly providerId: "openai";
    readonly dimensions: number;
    private apiKey;
    private model;
    private baseUrl;
    get modelId(): string;
    constructor(opts: {
        apiKey: string;
        model?: string;
        baseUrl?: string;
        dimensions?: number;
    });
    embed(text: string): Promise<number[]>;
    batchEmbed(texts: string[]): Promise<number[][]>;
}
export declare function getEmbeddingProvider(): EmbeddingProvider;
/** Reset provider singleton (e.g., after config reload) */
export declare function resetEmbeddingProvider(): void;
export declare function getEmbeddingCacheKey(provider: EmbeddingProvider, textChecksum: string): string;
export declare function getVectorBackendStatus(): {
    available: boolean;
    backend: "in_process_blob" | "none";
    reason?: string;
};
/** Encode float32 array to Buffer for SQLite BLOB storage */
export declare function encodeEmbedding(vec: number[]): Buffer;
/** Decode Buffer from SQLite to float32 array */
export declare function decodeEmbedding(buf: Buffer): number[];
/** Cosine similarity between two vectors */
export declare function cosineSimilarity(a: number[], b: number[]): number;
//# sourceMappingURL=embedding.d.ts.map