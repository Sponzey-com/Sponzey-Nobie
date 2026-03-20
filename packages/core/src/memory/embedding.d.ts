/**
 * Embedding providers for vector memory search.
 * Gracefully degrades to no-op if provider unavailable.
 */
export interface EmbeddingProvider {
    embed(text: string): Promise<number[]>;
    batchEmbed(texts: string[]): Promise<number[][]>;
    dimensions: number;
}
export declare class NullEmbeddingProvider implements EmbeddingProvider {
    readonly dimensions = 0;
    embed(): Promise<number[]>;
    batchEmbed(texts: string[]): Promise<number[][]>;
}
export declare class OllamaEmbeddingProvider implements EmbeddingProvider {
    readonly dimensions: number;
    private baseUrl;
    private model;
    constructor(opts?: {
        baseUrl?: string;
        model?: string;
        dimensions?: number;
    });
    embed(text: string): Promise<number[]>;
    batchEmbed(texts: string[]): Promise<number[][]>;
}
export declare class VoyageEmbeddingProvider implements EmbeddingProvider {
    readonly dimensions: number;
    private apiKey;
    private model;
    constructor(opts: {
        apiKey: string;
        model?: string;
        dimensions?: number;
    });
    embed(text: string): Promise<number[]>;
    batchEmbed(texts: string[]): Promise<number[][]>;
}
export declare class OpenAIEmbeddingProvider implements EmbeddingProvider {
    readonly dimensions: number;
    private apiKey;
    private model;
    private baseUrl;
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
/** Encode float32 array to Buffer for SQLite BLOB storage */
export declare function encodeEmbedding(vec: number[]): Buffer;
/** Decode Buffer from SQLite to float32 array */
export declare function decodeEmbedding(buf: Buffer): number[];
/** Cosine similarity between two vectors */
export declare function cosineSimilarity(a: number[], b: number[]): number;
//# sourceMappingURL=embedding.d.ts.map