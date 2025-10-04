import path from "node:path";
import fs from "fs-extra";

export async function fileExists(filePath: string): Promise<boolean> {
	const fullPath = path.join(process.cwd(), filePath);
	return await fs.pathExists(fullPath);
}

export async function writeComponentFile(
	filePath: string,
	content: string,
): Promise<void> {
	const fullPath = path.join(process.cwd(), filePath);
	await fs.ensureDir(path.dirname(fullPath));
	await fs.writeFile(fullPath, content, "utf8");
}
