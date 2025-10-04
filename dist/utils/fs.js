import fs from "fs-extra";
import path from "path";
export async function fileExists(filePath) {
	const fullPath = path.join(process.cwd(), filePath);
	return await fs.pathExists(fullPath);
}
export async function writeComponentFile(filePath, content) {
	const fullPath = path.join(process.cwd(), filePath);
	await fs.ensureDir(path.dirname(fullPath));
	await fs.writeFile(fullPath, content, "utf8");
}
