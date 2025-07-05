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
exports.getTailwindConfigPath = getTailwindConfigPath;
exports.rollbackInitChanges = rollbackInitChanges;
exports.detectFramework = detectFramework;
exports.getThemeByName = getThemeByName;
exports.generateDesignTokensCss = generateDesignTokensCss;
exports.generateTailwindV3Colors = generateTailwindV3Colors;
exports.generateTailwindV3ColorsString = generateTailwindV3ColorsString;
const fs_extra_1 = __importDefault(require("fs-extra"));
const path_1 = __importStar(require("path"));
const types_1 = require("../types");
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
    const componentFolder = path_1.default.basename(path_1.default.dirname(componentFilePath));
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
async function addDesignTokensToCss(cssFilePath, themeName = 'charcoal') {
    const fullPath = path_1.default.join(process.cwd(), cssFilePath);
    try {
        const theme = getThemeByName(themeName);
        const designTokens = generateDesignTokensCss(theme);
        let cssContent = '';
        if (await fs_extra_1.default.pathExists(fullPath)) {
            cssContent = await fs_extra_1.default.readFile(fullPath, 'utf8');
            // Check if tokens already exist
            if (cssContent.includes('@theme') && cssContent.includes('--color-nocta-')) {
                return false; // Tokens already exist
            }
        }
        // Split content into lines
        const lines = cssContent.split('\n');
        let lastImportIndex = -1;
        // Find the last @import statement
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('@import')) {
                lastImportIndex = i;
            }
            else if (line && !line.startsWith('@') && !line.startsWith('/*') && !line.startsWith('//')) {
                // Stop looking after we hit non-import, non-comment content
                break;
            }
        }
        let newContent;
        if (lastImportIndex >= 0) {
            // Insert tokens after the last import
            const beforeImports = lines.slice(0, lastImportIndex + 1);
            const afterImports = lines.slice(lastImportIndex + 1);
            // Add some spacing and the tokens
            const tokensWithSpacing = ['', designTokens, ''];
            newContent = [
                ...beforeImports,
                ...tokensWithSpacing,
                ...afterImports
            ].join('\n');
        }
        else {
            // No imports found, add tokens at the beginning
            newContent = `${designTokens}\n\n${cssContent}`;
        }
        await fs_extra_1.default.ensureDir(path_1.default.dirname(fullPath));
        await fs_extra_1.default.writeFile(fullPath, newContent, 'utf8');
        return true;
    }
    catch (error) {
        throw new Error(`Failed to add design tokens to CSS file: ${error}`);
    }
}
async function addDesignTokensToTailwindConfig(configFilePath, themeName = 'charcoal') {
    const fullPath = path_1.default.join(process.cwd(), configFilePath);
    try {
        const theme = getThemeByName(themeName);
        let configContent = '';
        const isTypeScript = configFilePath.endsWith('.ts');
        if (await fs_extra_1.default.pathExists(fullPath)) {
            configContent = await fs_extra_1.default.readFile(fullPath, 'utf8');
            // Check if nocta colors already exist
            if (configContent.includes('nocta:') || configContent.includes('"nocta"')) {
                return false; // Tokens already exist
            }
        }
        else {
            // Create a basic tailwind config if it doesn't exist
            if (isTypeScript) {
                configContent = `import type { Config } from "tailwindcss";

export default {
  content: [],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config;`;
            }
            else {
                configContent = `/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [],
  theme: {
    extend: {},
  },
  plugins: [],
}`;
            }
        }
        // Nocta colors object as a string
        const noctaColorsObject = generateTailwindV3ColorsString(theme);
        let modifiedContent = configContent;
        // Look for existing colors section in extend
        const lines = modifiedContent.split('\n');
        let inExtend = false;
        let inColors = false;
        let extendIndent = '';
        let colorsIndent = '';
        let foundColors = false;
        let foundExtend = false;
        let colorsEndIndex = -1;
        let extendEndIndex = -1;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            // Detect extend section
            if (trimmed.includes('extend:') && trimmed.includes('{')) {
                inExtend = true;
                foundExtend = true;
                extendIndent = line.match(/^(\s*)/)?.[1] || '  ';
                continue;
            }
            if (inExtend) {
                // Detect colors section inside extend
                if (trimmed.includes('colors:') && trimmed.includes('{')) {
                    inColors = true;
                    foundColors = true;
                    colorsIndent = line.match(/^(\s*)/)?.[1] || '    ';
                    continue;
                }
                // Find end of colors section (closing brace with comma or without)
                if (inColors && (trimmed === '},' || trimmed === '}')) {
                    const currentIndent = line.match(/^(\s*)/)?.[1] || '';
                    if (currentIndent.length <= colorsIndent.length) {
                        colorsEndIndex = i;
                        inColors = false;
                    }
                    continue;
                }
                // Find end of extend section
                if (!inColors && (trimmed === '},' || trimmed === '}')) {
                    const currentIndent = line.match(/^(\s*)/)?.[1] || '';
                    if (currentIndent.length <= extendIndent.length) {
                        extendEndIndex = i;
                        inExtend = false;
                        break;
                    }
                }
            }
        }
        if (foundColors && colorsEndIndex > -1) {
            // Add nocta colors to existing colors section
            const beforeColorsEnd = lines.slice(0, colorsEndIndex);
            const colorsEndLine = lines[colorsEndIndex];
            const afterColorsEnd = lines.slice(colorsEndIndex + 1);
            // Check if the last color has a comma
            let lastColorLine = '';
            for (let i = beforeColorsEnd.length - 1; i >= 0; i--) {
                const line = beforeColorsEnd[i].trim();
                if (line && !line.startsWith('colors:') && !line.includes('{')) {
                    lastColorLine = line;
                    break;
                }
            }
            const needsComma = lastColorLine && !lastColorLine.endsWith(',');
            const indentForNocta = colorsIndent + '  ';
            // Add comma to last existing color if needed
            if (needsComma) {
                for (let i = beforeColorsEnd.length - 1; i >= 0; i--) {
                    const line = beforeColorsEnd[i];
                    const trimmed = line.trim();
                    if (trimmed && !trimmed.startsWith('colors:') && !trimmed.includes('{') && !trimmed.includes('}')) {
                        beforeColorsEnd[i] = line + ',';
                        break;
                    }
                }
            }
            // Add nocta colors
            const noctaLines = noctaColorsObject.split('\n').map(line => line ? indentForNocta + line : line);
            modifiedContent = [
                ...beforeColorsEnd,
                ...noctaLines,
                colorsEndLine,
                ...afterColorsEnd
            ].join('\n');
        }
        else if (foundExtend && extendEndIndex > -1) {
            // Add colors section to existing extend
            const beforeExtendEnd = lines.slice(0, extendEndIndex);
            const extendEndLine = lines[extendEndIndex];
            const afterExtendEnd = lines.slice(extendEndIndex + 1);
            // Check if extend has existing content
            let hasContent = false;
            for (let i = beforeExtendEnd.length - 1; i >= 0; i--) {
                const line = beforeExtendEnd[i].trim();
                if (line && !line.includes('extend:') && !line.includes('{')) {
                    hasContent = true;
                    if (!line.endsWith(',')) {
                        beforeExtendEnd[i] = beforeExtendEnd[i] + ',';
                    }
                    break;
                }
            }
            const colorsLines = [
                `${extendIndent}  colors: {`,
                ...noctaColorsObject.split('\n').map(line => line ? `${extendIndent}    ${line}` : line),
                `${extendIndent}  }${hasContent ? ',' : ''}`
            ];
            modifiedContent = [
                ...beforeExtendEnd,
                ...colorsLines,
                extendEndLine,
                ...afterExtendEnd
            ].join('\n');
        }
        else {
            // No extend section, add complete theme.extend
            const themeRegex = /(theme:\s*{)(\s*)(})/;
            if (themeRegex.test(modifiedContent)) {
                modifiedContent = modifiedContent.replace(themeRegex, (match, before, whitespace, after) => {
                    return `${before}\n    extend: {\n      colors: {\n        ${noctaColorsObject}\n      }\n    },\n  ${after}`;
                });
            }
        }
        await fs_extra_1.default.ensureDir(path_1.default.dirname(fullPath));
        await fs_extra_1.default.writeFile(fullPath, modifiedContent, 'utf8');
        return true;
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
async function getTailwindConfigPath() {
    const isTs = await isTypeScriptProject();
    // Check if tailwind.config.ts exists (preferred for TS projects)
    if (isTs && await fs_extra_1.default.pathExists('tailwind.config.ts')) {
        return 'tailwind.config.ts';
    }
    // Check if tailwind.config.js exists
    if (await fs_extra_1.default.pathExists('tailwind.config.js')) {
        return 'tailwind.config.js';
    }
    // Return preferred extension based on project type
    return isTs ? 'tailwind.config.ts' : 'tailwind.config.js';
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
function getThemeByName(themeName) {
    const theme = types_1.AVAILABLE_THEMES.find(t => t.name === themeName);
    if (!theme) {
        throw new Error(`Theme "${themeName}" not found`);
    }
    return theme;
}
function generateDesignTokensCss(theme) {
    const tokens = Object.entries(theme.colors)
        .map(([key, value]) => `  --color-nocta-${key}: ${value};`)
        .join('\n');
    return `@theme {\n${tokens}\n}`;
}
function generateTailwindV3Colors(theme) {
    return {
        nocta: theme.colors
    };
}
function generateTailwindV3ColorsString(theme) {
    const colors = Object.entries(theme.colors)
        .map(([key, value]) => `        "${key}": "${value}"`)
        .join(',\n');
    return `"nocta": {\n${colors}\n      }`;
}
