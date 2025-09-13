"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getInstalledDependencies = getInstalledDependencies;
exports.readConfig = readConfig;
exports.writeConfig = writeConfig;
exports.fileExists = fileExists;
exports.writeComponentFile = writeComponentFile;
exports.resolveComponentPath = resolveComponentPath;
exports.installDependencies = installDependencies;
exports.addDesignTokensToCss = addDesignTokensToCss;
exports.addDesignTokensToTailwindConfig = addDesignTokensToTailwindConfig;
exports.checkTailwindInstallation = checkTailwindInstallation;
exports.isTypeScriptProject = isTypeScriptProject;
exports.rollbackInitChanges = rollbackInitChanges;
exports.detectFramework = detectFramework;
const fs_extra_1 = __importDefault(require("fs-extra"));
const path_1 = __importStar(require("path"));
const fs_1 = require("fs");
async function getInstalledDependencies() {
    try {
        const packageJsonPath = (0, path_1.join)(process.cwd(), 'package.json');
        if (!(0, fs_1.existsSync)(packageJsonPath)) {
            return {};
        }
        const packageJson = JSON.parse((0, fs_1.readFileSync)(packageJsonPath, 'utf8'));
        // Get dependencies from package.json
        const allDeps = {
            ...packageJson.dependencies,
            ...packageJson.devDependencies
        };
        // Try to get actual installed versions from node_modules
        const actualVersions = {};
        for (const depName of Object.keys(allDeps)) {
            try {
                // Try to get the actual installed version
                const nodeModulesPath = (0, path_1.join)(process.cwd(), 'node_modules', depName, 'package.json');
                if ((0, fs_1.existsSync)(nodeModulesPath)) {
                    const depPackageJson = JSON.parse((0, fs_1.readFileSync)(nodeModulesPath, 'utf8'));
                    actualVersions[depName] = depPackageJson.version;
                }
                else {
                    // Fallback to version from package.json
                    actualVersions[depName] = allDeps[depName];
                }
            }
            catch (error) {
                // If we can't read the specific package, use version from package.json
                actualVersions[depName] = allDeps[depName];
            }
        }
        return actualVersions;
    }
    catch (error) {
        return {};
    }
}
async function readConfig() {
    const configPath = path_1.default.join(process.cwd(), 'nocta.config.json');
    if (!(await fs_extra_1.default.pathExists(configPath))) {
        return null;
    }
    try {
        return await fs_extra_1.default.readJson(configPath);
    }
    catch (error) {
        throw new Error(`Failed to read nocta.config.json: ${error}`);
    }
}
async function writeConfig(config) {
    const configPath = path_1.default.join(process.cwd(), 'nocta.config.json');
    await fs_extra_1.default.writeJson(configPath, config, { spaces: 2 });
}
async function fileExists(filePath) {
    const fullPath = path_1.default.join(process.cwd(), filePath);
    return await fs_extra_1.default.pathExists(fullPath);
}
async function writeComponentFile(filePath, content) {
    const fullPath = path_1.default.join(process.cwd(), filePath);
    await fs_extra_1.default.ensureDir(path_1.default.dirname(fullPath));
    await fs_extra_1.default.writeFile(fullPath, content, 'utf8');
}
function resolveComponentPath(componentFilePath, config) {
    const fileName = path_1.default.basename(componentFilePath);
    return path_1.default.join(config.aliases.components, 'ui', fileName);
}
async function installDependencies(dependencies) {
    const deps = Object.keys(dependencies);
    if (deps.length === 0)
        return;
    const { execSync } = require('child_process');
    let packageManager = 'npm';
    if (await fs_extra_1.default.pathExists('yarn.lock')) {
        packageManager = 'yarn';
    }
    else if (await fs_extra_1.default.pathExists('pnpm-lock.yaml')) {
        packageManager = 'pnpm';
    }
    const installCmd = packageManager === 'yarn'
        ? `yarn add ${deps.join(' ')}`
        : packageManager === 'pnpm'
            ? `pnpm add ${deps.join(' ')}`
            : `npm install ${deps.join(' ')}`;
    console.log(`Installing dependencies with ${packageManager}...`);
    execSync(installCmd, { stdio: 'inherit' });
}
async function addDesignTokensToCss(cssFilePath) {
    // Tailwind v4: inject semantic color variables and @theme mapping (see new-config.md)
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
	--color-overlay: oklch(0.145 0 0);
	--color-gradient-primary-start: oklch(0.205 0 0);
	--color-gradient-primary-end: oklch(0.371 0 0);
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
	--color-gradient-primary-end: oklch(0.371 0 0);
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
	--color-border-subtle: var(--border-subtle);
	--color-ring: var(--ring);
	--color-ring-offset: var(--ring-offset);
	--color-primary-foreground: var(--primary-foreground);
	--color-gradient-primary-start: var(--gradient-primary-start);
	--color-gradient-primary-end: var(--gradient-primary-end);
	--color-overlay: var(--overlay);
}`;
    try {
        let cssContent = '';
        if (await fs_extra_1.default.pathExists(fullPath)) {
            cssContent = await fs_extra_1.default.readFile(fullPath, 'utf8');
            // Consider tokens already present only if a rich subset exists
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
        // Avoid duplicating @import if it's already present
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
async function addDesignTokensToTailwindConfig(configFilePath) {
    try {
        // Tailwind v3 support has been removed. This function is kept for backward compatibility
        // but will always throw to signal the change.
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
        // Also check if it exists in node_modules
        const nodeModulesPath = path_1.default.join(process.cwd(), 'node_modules', 'tailwindcss');
        const existsInNodeModules = await fs_extra_1.default.pathExists(nodeModulesPath);
        return {
            installed: existsInNodeModules,
            version: tailwindVersion
        };
    }
    catch (error) {
        return { installed: false };
    }
}
async function isTypeScriptProject() {
    try {
        const packageJson = await fs_extra_1.default.readJson('package.json');
        const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
        // Check if TypeScript is installed
        const hasTypeScript = 'typescript' in dependencies || '@types/node' in dependencies;
        // Also check for tsconfig.json
        const hasTsConfig = await fs_extra_1.default.pathExists('tsconfig.json');
        return hasTypeScript || hasTsConfig;
    }
    catch (error) {
        return false;
    }
}
async function rollbackInitChanges() {
    const filesToCheck = [
        'nocta.config.json',
        'tailwind.config.js',
        'tailwind.config.ts',
        'lib/utils.ts',
        'src/lib/utils.ts'
    ];
    for (const file of filesToCheck) {
        const fullPath = path_1.default.join(process.cwd(), file);
        if (await fs_extra_1.default.pathExists(fullPath)) {
            try {
                await fs_extra_1.default.remove(fullPath);
            }
            catch (error) {
                // Ignore errors when removing files
            }
        }
    }
}
async function detectFramework() {
    try {
        // Read package.json to check dependencies
        let packageJson = {};
        try {
            packageJson = await fs_extra_1.default.readJson('package.json');
        }
        catch {
            return {
                framework: 'unknown',
                details: {
                    hasConfig: false,
                    hasReactDependency: false,
                    hasFrameworkDependency: false,
                    configFiles: []
                }
            };
        }
        const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
        const hasReact = 'react' in dependencies;
        // Check for Next.js
        const nextConfigFiles = ['next.config.js', 'next.config.mjs', 'next.config.ts'];
        const foundNextConfigs = [];
        for (const config of nextConfigFiles) {
            if (await fs_extra_1.default.pathExists(config)) {
                foundNextConfigs.push(config);
            }
        }
        const hasNext = 'next' in dependencies;
        if (hasNext || foundNextConfigs.length > 0) {
            // Determine app structure
            let appStructure = 'unknown';
            if (await fs_extra_1.default.pathExists('app') && await fs_extra_1.default.pathExists('app/layout.tsx')) {
                appStructure = 'app-router';
            }
            else if (await fs_extra_1.default.pathExists('pages') && (await fs_extra_1.default.pathExists('pages/_app.tsx') ||
                await fs_extra_1.default.pathExists('pages/_app.js') ||
                await fs_extra_1.default.pathExists('pages/index.tsx') ||
                await fs_extra_1.default.pathExists('pages/index.js'))) {
                appStructure = 'pages-router';
            }
            return {
                framework: 'nextjs',
                version: dependencies.next,
                details: {
                    hasConfig: foundNextConfigs.length > 0,
                    hasReactDependency: hasReact,
                    hasFrameworkDependency: hasNext,
                    appStructure,
                    configFiles: foundNextConfigs
                }
            };
        }
        // Check for React Router 7
        const reactRouterConfigFiles = ['react-router.config.ts', 'react-router.config.js'];
        const foundReactRouterConfigs = [];
        for (const config of reactRouterConfigFiles) {
            if (await fs_extra_1.default.pathExists(config)) {
                foundReactRouterConfigs.push(config);
            }
        }
        const hasReactRouter = 'react-router' in dependencies;
        const hasReactRouterDev = '@react-router/dev' in dependencies;
        if (hasReactRouter && hasReact) {
            // Additional validation for React Router 7 in framework mode
            let isReactRouterFramework = false;
            // Check for React Router 7 framework mode indicators
            const reactRouterIndicators = [
                'app/routes.ts',
                'app/root.tsx',
                'app/entry.client.tsx',
                'app/entry.server.tsx'
            ];
            for (const indicator of reactRouterIndicators) {
                if (await fs_extra_1.default.pathExists(indicator)) {
                    isReactRouterFramework = true;
                    break;
                }
            }
            // Also check for the dev dependency which is required for framework mode
            if (hasReactRouterDev || foundReactRouterConfigs.length > 0) {
                isReactRouterFramework = true;
            }
            if (isReactRouterFramework) {
                return {
                    framework: 'react-router',
                    version: dependencies['react-router'],
                    details: {
                        hasConfig: foundReactRouterConfigs.length > 0,
                        hasReactDependency: hasReact,
                        hasFrameworkDependency: hasReactRouter,
                        configFiles: foundReactRouterConfigs
                    }
                };
            }
        }
        // Check for Vite + React
        const viteConfigFiles = ['vite.config.js', 'vite.config.ts', 'vite.config.mjs'];
        const foundViteConfigs = [];
        for (const config of viteConfigFiles) {
            if (await fs_extra_1.default.pathExists(config)) {
                foundViteConfigs.push(config);
            }
        }
        const hasVite = 'vite' in dependencies;
        const hasViteReactPlugin = '@vitejs/plugin-react' in dependencies || '@vitejs/plugin-react-swc' in dependencies;
        if ((hasVite || foundViteConfigs.length > 0) && hasReact) {
            // Additional validation for Vite + React
            let isReactProject = hasViteReactPlugin;
            // Check if there's a typical React structure
            if (!isReactProject) {
                const reactIndicators = [
                    'src/App.tsx',
                    'src/App.jsx',
                    'src/main.tsx',
                    'src/main.jsx',
                    'index.html'
                ];
                for (const indicator of reactIndicators) {
                    if (await fs_extra_1.default.pathExists(indicator)) {
                        // Check if index.html contains React root
                        if (indicator === 'index.html') {
                            try {
                                const htmlContent = await fs_extra_1.default.readFile('index.html', 'utf8');
                                if (htmlContent.includes('id="root"') || htmlContent.includes('id=\'root\'')) {
                                    isReactProject = true;
                                    break;
                                }
                            }
                            catch {
                                // Continue checking other files
                            }
                        }
                        else {
                            isReactProject = true;
                            break;
                        }
                    }
                }
            }
            if (isReactProject) {
                return {
                    framework: 'vite-react',
                    version: dependencies.vite,
                    details: {
                        hasConfig: foundViteConfigs.length > 0,
                        hasReactDependency: hasReact,
                        hasFrameworkDependency: hasVite,
                        configFiles: foundViteConfigs
                    }
                };
            }
        }
        // If we have React but no clear framework, it might be Create React App or custom setup
        if (hasReact) {
            // Check for Create React App indicators
            const craIndicators = ['react-scripts' in dependencies, await fs_extra_1.default.pathExists('public/index.html')];
            if (craIndicators.some(Boolean)) {
                return {
                    framework: 'unknown', // We'll treat CRA as unknown for now since it's not explicitly supported
                    details: {
                        hasConfig: false,
                        hasReactDependency: true,
                        hasFrameworkDependency: false,
                        configFiles: []
                    }
                };
            }
        }
        return {
            framework: 'unknown',
            details: {
                hasConfig: false,
                hasReactDependency: hasReact,
                hasFrameworkDependency: false,
                configFiles: []
            }
        };
    }
    catch (error) {
        return {
            framework: 'unknown',
            details: {
                hasConfig: false,
                hasReactDependency: false,
                hasFrameworkDependency: false,
                configFiles: []
            }
        };
    }
}
