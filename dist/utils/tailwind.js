"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.addDesignTokensToCss = addDesignTokensToCss;
exports.checkTailwindInstallation = checkTailwindInstallation;
const node_path_1 = __importDefault(require("node:path"));
const fs_extra_1 = __importDefault(require("fs-extra"));
const registry_1 = require("./registry");
const CSS_REGISTRY_PATH = "css/index.css";
async function addDesignTokensToCss(cssFilePath) {
    const fullPath = node_path_1.default.join(process.cwd(), cssFilePath);
    const tailwindImportPattern = /@import\s+["']tailwindcss["'];?/i;
    try {
        const registryCss = await (0, registry_1.getRegistryAsset)(CSS_REGISTRY_PATH);
        const trimmedRegistryCss = registryCss.trimStart();
        let cssContent = "";
        if (await fs_extra_1.default.pathExists(fullPath)) {
            cssContent = await fs_extra_1.default.readFile(fullPath, "utf8");
            const hasRegistryTheme = cssContent.includes("NOCTA CSS THEME VARIABLES");
            if (hasRegistryTheme) {
                return false;
            }
        }
        const lines = cssContent.split("\n");
        let lastImportIndex = -1;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith("@import"))
                lastImportIndex = i;
            else if (line &&
                !line.startsWith("@") &&
                !line.startsWith("/*") &&
                !line.startsWith("//"))
                break;
        }
        const hasImport = tailwindImportPattern.test(cssContent);
        const normalizedSnippet = hasImport
            ? trimmedRegistryCss.replace(tailwindImportPattern, "").trimStart()
            : trimmedRegistryCss;
        let newContent;
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
        }
        else {
            newContent = `${normalizedSnippet}\n\n${cssContent}`;
        }
        await fs_extra_1.default.ensureDir(node_path_1.default.dirname(fullPath));
        await fs_extra_1.default.writeFile(fullPath, newContent, "utf8");
        return true;
    }
    catch (error) {
        throw new Error(`Failed to add design tokens to CSS file: ${error}`);
    }
}
async function checkTailwindInstallation() {
    try {
        const packageJson = await fs_extra_1.default.readJson("package.json");
        const tailwindVersion = packageJson.dependencies?.tailwindcss ||
            packageJson.devDependencies?.tailwindcss;
        if (!tailwindVersion) {
            return { installed: false };
        }
        const nodeModulesPath = node_path_1.default.join(process.cwd(), "node_modules", "tailwindcss");
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
