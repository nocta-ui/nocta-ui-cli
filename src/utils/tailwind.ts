import fs from "fs-extra";
import path from "path";

export async function addDesignTokensToCss(
	cssFilePath: string,
): Promise<boolean> {
	const fullPath = path.join(process.cwd(), cssFilePath);

	const V4_SNIPPET = `@import "tailwindcss";

:root {
	--color-background: oklch(0.997 0.0031 229.76);
	--color-background-muted: oklch(0.972 0.0031 229.76);
	--color-background-elevated: oklch(0.92 0.0031 229.76);
	--color-foreground: oklch(0.205 0.0031 229.76);
	--color-foreground-muted: oklch(0.371 0.0031 229.76);
	--color-foreground-subtle: oklch(0.708 0.0031 229.76);
	--color-border: oklch(0.205 0.0031 229.76 / 0.1);
	--color-border-muted: oklch(0.942 0.0031 229.76 / 0.8);
	--color-ring: oklch(0.205 0.0031 229.76);
	--color-ring-offset: oklch(0.97 0.0031 229.76);
	--color-primary: oklch(0.205 0.0031 229.76);
	--color-primary-foreground: oklch(0.97 0.0031 229.76);
	--color-primary-muted: oklch(0.371 0.0031 229.76);
	--color-overlay: oklch(0.97 0.0031 229.76);
	--color-error: oklch(0.65 0.17 25);
	--color-warning: oklch(0.82 0.15 75);
	--color-success: oklch(0.72 0.15 150);
	--radius-base: 0.125rem;
}

.dark {
	--color-background: oklch(0.205 0.0031 229.76);
	--color-background-muted: oklch(0.249 0.0031 229.76);
	--color-background-elevated: oklch(0.351 0.0031 229.76);
	--color-foreground: oklch(0.97 0.0031 229.76);
	--color-foreground-muted: oklch(0.87 0.0031 229.76);
	--color-foreground-subtle: oklch(0.556 0.0031 229.76);
	--color-border: oklch(0.97 0.0031 229.76 / 0.1);
	--color-border-muted: oklch(0.269 0.0031 229.76 / 0.8);
	--color-ring: oklch(0.97 0.0031 229.76);
	--color-ring-offset: oklch(0.205 0.0031 229.76);
	--color-primary: oklch(0.97 0.0031 229.76);
	--color-primary-foreground: oklch(0.205 0.0031 229.76);
	--color-primary-muted: oklch(0.87 0.0031 229.76);
	--color-overlay: oklch(0.145 0.0031 229.76);
	--color-error: oklch(0.58 0.19 25);
	--color-warning: oklch(0.74 0.15 75);
	--color-success: oklch(0.64 0.15 150);
	--radius-base: 0.125rem;
}

@theme {
	--color-background: var(--background);
	--color-background-muted: var(--background-muted);
	--color-background-elevated: var(--background-elevated);
	--color-foreground: var(--foreground);
	--color-foreground-muted: var(--foreground-muted);
	--color-foreground-subtle: var(--foreground-subtle);
	--color-primary: var(--primary);
	--color-primary-muted: var(--primary-muted);
	--color-border: var(--border);
	--color-border-muted: var(--border-muted);
	--color-ring: var(--ring);
	--color-ring-offset: var(--ring-offset);
	--color-primary-foreground: var(--primary-foreground);
	--color-overlay: var(--overlay);
	--color-error: var(--error);
	--color-warning: var(--warning);
	--color-success: var(--success);
	--radius-xs: calc(var(--radius-base) * 1);
	--radius-sm: calc(var(--radius-base) * 2);
	--radius-md: calc(var(--radius-base) * 3);
	--radius-lg: calc(var(--radius-base) * 4);
	--radius-xl: calc(var(--radius-base) * 6);
	--radius-2xl: calc(var(--radius-base) * 8);
	--radius-3xl: calc(var(--radius-base) * 12);
	--radius-4xl: calc(var(--radius-base) * 16);
	--radius-full: 9999px;
}`;

	try {
		let cssContent = "";
		if (await fs.pathExists(fullPath)) {
			cssContent = await fs.readFile(fullPath, "utf8");
			const hasRichTheme =
				cssContent.includes("--color-primary-muted") &&
				cssContent.includes("--color-gradient-primary-start");
			if (cssContent.includes("@theme") && hasRichTheme) {
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

		const hasImport = /@import\s+["']tailwindcss["'];?/i.test(cssContent);
		const snippet = hasImport
			? V4_SNIPPET.replace(
					/@import\s+["']tailwindcss["'];?\s*/i,
					"",
				).trimStart()
			: V4_SNIPPET;

		let newContent: string;
		if (lastImportIndex >= 0) {
			const beforeImports = lines.slice(0, lastImportIndex + 1);
			const afterImports = lines.slice(lastImportIndex + 1);
			newContent = [...beforeImports, "", snippet, "", ...afterImports].join(
				"\n",
			);
		} else {
			newContent = `${snippet}\n\n${cssContent}`;
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
		const tailwindVersion =
			packageJson.dependencies?.tailwindcss ||
			packageJson.devDependencies?.tailwindcss;

		if (!tailwindVersion) {
			return { installed: false };
		}

		const nodeModulesPath = path.join(
			process.cwd(),
			"node_modules",
			"tailwindcss",
		);
		const existsInNodeModules = await fs.pathExists(nodeModulesPath);

		return {
			installed: existsInNodeModules,
			version: tailwindVersion,
		};
	} catch {
		return { installed: false };
	}
}
