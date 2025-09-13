"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.addDesignTokensToCss = addDesignTokensToCss;
exports.addDesignTokensToTailwindConfig = addDesignTokensToTailwindConfig;
exports.checkTailwindInstallation = checkTailwindInstallation;
const fs_extra_1 = __importDefault(require("fs-extra"));
const path_1 = __importDefault(require("path"));
async function addDesignTokensToCss(cssFilePath) {
    const fullPath = path_1.default.join(process.cwd(), cssFilePath);
    const V4_SNIPPET = `@import "tailwindcss";

:root {
	--color-background: oklch(0.97 0 0);
	--color-background-muted: oklch(0.922 0 0);
	--color-background-elevated: oklch(0.87 0 0);
	--color-foreground: oklch(0.205 0 0);
	--color-foreground-muted: oklch(0.371 0 0);
	--color-foreground-subtle: oklch(0.708 0 0);
	--color-border: oklch(0.205 0 0);
	--color-border-muted: oklch(0.922 0 0);
	--color-border-subtle: oklch(0.708 0 0);
	--color-ring: oklch(0.205 0 0);
	--color-ring-offset: oklch(0.97 0 0);
	--color-primary: oklch(0.205 0 0);
	--color-primary-foreground: oklch(0.97 0 0);
	--color-primary-muted: oklch(0.371 0 0);
	--color-overlay: oklch(0.97 0 0);
	--color-gradient-primary-start: oklch(0.371 0 0);
	--color-gradient-primary-end: oklch(0.205 0 0);
	--color-primary-white: oklch(0.97 0 0);
}

.dark {
	--color-background: oklch(0.205 0 0);
	--color-background-muted: oklch(0.269 0 0);
	--color-background-elevated: oklch(0.371 0 0);
	--color-foreground: oklch(0.97 0 0);
	--color-foreground-muted: oklch(0.87 0 0);
	--color-foreground-subtle: oklch(0.556 0 0);
	--color-border: oklch(0.97 0 0);
	--color-border-muted: oklch(0.269 0 0);
	--color-border-subtle: oklch(0.371 0 0);
	--color-ring: oklch(0.97 0 0);
	--color-ring-offset: oklch(0.205 0 0);
	--color-primary: oklch(0.97 0 0);
	--color-primary-foreground: oklch(0.205 0 0);
	--color-primary-muted: oklch(0.87 0 0);
	--color-overlay: oklch(0.145 0 0);
	--color-gradient-primary-start: oklch(0.371 0 0);
	--color-gradient-primary-end: oklch(0.2768 0 0);
	--color-primary-white: oklch(0.922 0 0);
}

@theme {
	--font-sfpro: var(--font-sfpro);
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
	--color-border-subtle: var(--border-subtle);
	--color-ring: var(--ring);
	--color-ring-offset: var(--ring-offset);
	--color-primary-foreground: var(--primary-foreground);
	--color-gradient-primary-start: var(--gradient-primary-start);
	--color-gradient-primary-end: var(--gradient-primary-end);
	--color-overlay: var(--overlay);
	--color-primary-white: var(--primary-white);
}`;
    try {
        let cssContent = '';
        if (await fs_extra_1.default.pathExists(fullPath)) {
            cssContent = await fs_extra_1.default.readFile(fullPath, 'utf8');
            const hasRichTheme = cssContent.includes('--color-primary-muted') && cssContent.includes('--color-gradient-primary-start');
            if (cssContent.includes('@theme') && hasRichTheme) {
                return false;
            }
        }
        const lines = cssContent.split('\n');
        let lastImportIndex = -1;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('@import'))
                lastImportIndex = i;
            else if (line && !line.startsWith('@') && !line.startsWith('/*') && !line.startsWith('//'))
                break;
        }
        const hasImport = /@import\s+["']tailwindcss["'];?/i.test(cssContent);
        const snippet = hasImport
            ? V4_SNIPPET.replace(/@import\s+["']tailwindcss["'];?\s*/i, '').trimStart()
            : V4_SNIPPET;
        let newContent;
        if (lastImportIndex >= 0) {
            const beforeImports = lines.slice(0, lastImportIndex + 1);
            const afterImports = lines.slice(lastImportIndex + 1);
            newContent = [...beforeImports, '', snippet, '', ...afterImports].join('\n');
        }
        else {
            newContent = `${snippet}\n\n${cssContent}`;
        }
        await fs_extra_1.default.ensureDir(path_1.default.dirname(fullPath));
        await fs_extra_1.default.writeFile(fullPath, newContent, 'utf8');
        return true;
    }
    catch (error) {
        throw new Error(`Failed to add design tokens to CSS file: ${error}`);
    }
}
async function addDesignTokensToTailwindConfig(_configFilePath) {
    try {
        throw new Error('Tailwind v3 is no longer supported by nocta-ui CLI');
    }
    catch (error) {
        throw new Error(`Failed to add design tokens to Tailwind config: ${error}`);
    }
}
async function checkTailwindInstallation() {
    try {
        const packageJson = await fs_extra_1.default.readJson('package.json');
        const tailwindVersion = packageJson.dependencies?.tailwindcss || packageJson.devDependencies?.tailwindcss;
        if (!tailwindVersion) {
            return { installed: false };
        }
        const nodeModulesPath = path_1.default.join(process.cwd(), 'node_modules', 'tailwindcss');
        const existsInNodeModules = await fs_extra_1.default.pathExists(nodeModulesPath);
        return {
            installed: existsInNodeModules,
            version: tailwindVersion,
        };
    }
    catch {
        return { installed: false };
    }
}
