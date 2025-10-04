import path from "node:path";
import fs from "fs-extra";

function getCacheBaseDir(): string {
	const custom = process.env.NOCTA_CACHE_DIR;
	if (custom && custom.trim()) return custom;
	return path.join(process.cwd(), ".nocta-cache");
}

function resolveCachePath(relPath: string): string {
	const safeRel = relPath.replace(/^\/+/, "");
	return path.join(getCacheBaseDir(), safeRel);
}

async function ensureDirFor(filePath: string): Promise<void> {
	await fs.ensureDir(path.dirname(filePath));
}

export async function readCacheText(
	relPath: string,
	ttlMs?: number,
	opts?: { acceptStale?: boolean },
): Promise<string | null> {
	const fullPath = resolveCachePath(relPath);
	if (!(await fs.pathExists(fullPath))) return null;

	try {
		if (!opts?.acceptStale && typeof ttlMs === "number") {
			const stat = await fs.stat(fullPath);
			const ageMs = Date.now() - stat.mtimeMs;
			if (ageMs > ttlMs) return null;
		}
		return await fs.readFile(fullPath, "utf8");
	} catch {
		return null;
	}
}

export async function writeCacheText(
	relPath: string,
	content: string,
): Promise<void> {
	const fullPath = resolveCachePath(relPath);
	await ensureDirFor(fullPath);
	await fs.writeFile(fullPath, content, "utf8");
}

export function getCacheDir(): string {
	return getCacheBaseDir();
}
