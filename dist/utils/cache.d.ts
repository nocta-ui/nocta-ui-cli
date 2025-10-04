export declare function readCacheText(relPath: string, ttlMs?: number, opts?: {
    acceptStale?: boolean;
}): Promise<string | null>;
export declare function writeCacheText(relPath: string, content: string): Promise<void>;
export declare function getCacheDir(): string;
