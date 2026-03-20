/**
 * FileIndexer: indexes local files into SQLite for semantic search.
 * Chunks files, stores in file_chunks table, optionally embeds vectors.
 */
export declare class FileIndexer {
    indexFile(filePath: string): Promise<{
        chunks: number;
        embedded: boolean;
    }>;
    indexDirectory(dir: string, opts?: {
        exclude?: string[];
        recursive?: boolean;
        onProgress?: (file: string, chunks: number) => void;
    }): Promise<{
        files: number;
        chunks: number;
    }>;
    removeFile(filePath: string): void;
    removeDirectory(dir: string): void;
    getStats(): {
        files: number;
        chunks: number;
        embedded: number;
    };
    searchByText(query: string, limit?: number): Array<{
        file_path: string;
        chunk_index: number;
        content: string;
        score: number;
    }>;
    searchByVector(query: string, limit?: number): Promise<Array<{
        file_path: string;
        chunk_index: number;
        content: string;
        score: number;
    }>>;
}
export declare const fileIndexer: FileIndexer;
//# sourceMappingURL=file-indexer.d.ts.map