import path from "node:path";
import fs from "fs-extra";
export async function rollbackInitChanges(paths = []) {
    const uniquePaths = Array.from(new Set(paths));
    for (const targetPath of uniquePaths) {
        const normalizedPath = path.isAbsolute(targetPath)
            ? targetPath
            : path.join(process.cwd(), targetPath);
        if (!(await fs.pathExists(normalizedPath))) {
            continue;
        }
        try {
            await fs.remove(normalizedPath);
        }
        catch {
            // ignore cleanup errors during rollback
        }
    }
}
