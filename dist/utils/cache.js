import path from "node:path";
import fs from "fs-extra";
function getCacheBaseDir() {
    const custom = process.env.NOCTA_CACHE_DIR;
    if (custom && custom.trim())
        return custom;
    return path.join(process.cwd(), ".nocta-cache");
}
function resolveCachePath(relPath) {
    const safeRel = relPath.replace(/^\/+/, "");
    return path.join(getCacheBaseDir(), safeRel);
}
async function ensureDirFor(filePath) {
    await fs.ensureDir(path.dirname(filePath));
}
export async function readCacheText(relPath, ttlMs, opts) {
    const fullPath = resolveCachePath(relPath);
    if (!(await fs.pathExists(fullPath)))
        return null;
    try {
        if (!opts?.acceptStale && typeof ttlMs === "number") {
            const stat = await fs.stat(fullPath);
            const ageMs = Date.now() - stat.mtimeMs;
            if (ageMs > ttlMs)
                return null;
        }
        return await fs.readFile(fullPath, "utf8");
    }
    catch {
        return null;
    }
}
export async function writeCacheText(relPath, content) {
    const fullPath = resolveCachePath(relPath);
    await ensureDirFor(fullPath);
    await fs.writeFile(fullPath, content, "utf8");
}
export function getCacheDir() {
    return getCacheBaseDir();
}
