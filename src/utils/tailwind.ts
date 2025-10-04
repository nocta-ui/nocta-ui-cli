import path from "node:path";
import fs from "fs-extra";

import { getRegistryAsset } from "./registry.js";

const CSS_REGISTRY_PATH = "css/index.css";

export async function addDesignTokensToCss(
	cssFilePath: string,
): Promise<boolean> {
	const fullPath = path.join(process.cwd(), cssFilePath);
	const tailwindImportPattern = /@import\s+["']tailwindcss["'];?/i;

	try {
		const registryCss = await getRegistryAsset(CSS_REGISTRY_PATH);
		const trimmedRegistryCss = registryCss.trimStart();
		let cssContent = "";
		if (await fs.pathExists(fullPath)) {
			cssContent = await fs.readFile(fullPath, "utf8");
			const hasRegistryTheme = cssContent.includes("NOCTA CSS THEME VARIABLES");
			if (hasRegistryTheme) {
				return false;
			}
		}

		const lines = cssContent.split("\n");
		let lastImportIndex = -1;
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();
			if (line.startsWith("@import")) lastImportIndex = i;
			else if (
				line &&
				!line.startsWith("@") &&
				!line.startsWith("/*") &&
				!line.startsWith("//")
			)
				break;
		}

		const hasImport = tailwindImportPattern.test(cssContent);
		const normalizedSnippet = hasImport
			? trimmedRegistryCss.replace(tailwindImportPattern, "").trimStart()
			: trimmedRegistryCss;

		let newContent: string;
		if (lastImportIndex >= 0) {
			const beforeImports = lines.slice(0, lastImportIndex + 1);
			const afterImports = lines.slice(lastImportIndex + 1);
			newContent = [
				...beforeImports,
				"",
				normalizedSnippet,
				"",
				...afterImports,
			].join("\n");
		} else {
			newContent = `${normalizedSnippet}\n\n${cssContent}`;
		}

		await fs.ensureDir(path.dirname(fullPath));
		await fs.writeFile(fullPath, newContent, "utf8");
		return true;
	} catch (error) {
		throw new Error(`Failed to add design tokens to CSS file: ${error}`);
	}
}

export async function checkTailwindInstallation(): Promise<{
	installed: boolean;
	version?: string;
}> {
	try {
		const packageJson = await fs.readJson("package.json");
		const declared =
			packageJson.dependencies?.tailwindcss ||
			packageJson.devDependencies?.tailwindcss;

		if (!declared) {
			return { installed: false };
		}

		const pkgPath = path.join(
			process.cwd(),
			"node_modules",
			"tailwindcss",
			"package.json",
		);

		if (await fs.pathExists(pkgPath)) {
			try {
				const tailwindPkg = await fs.readJson(pkgPath);
				const actualVersion = tailwindPkg?.version as string | undefined;
				if (actualVersion) {
					return { installed: true, version: actualVersion };
				}
			} catch {
				// fall through to declared
			}
			// Installed but version unknown; surface declared
			return { installed: true, version: declared };
		}

		return { installed: false };
	} catch {
		return { installed: false };
	}
}
