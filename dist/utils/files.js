"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readConfig = readConfig;
exports.writeConfig = writeConfig;
exports.fileExists = fileExists;
exports.writeComponentFile = writeComponentFile;
exports.resolveComponentPath = resolveComponentPath;
exports.installDependencies = installDependencies;
exports.addDesignTokensToCss = addDesignTokensToCss;
exports.addDesignTokensToTailwindConfig = addDesignTokensToTailwindConfig;
exports.checkTailwindInstallation = checkTailwindInstallation;
exports.rollbackInitChanges = rollbackInitChanges;
exports.detectFramework = detectFramework;
const fs_extra_1 = __importDefault(require("fs-extra"));
const path_1 = __importDefault(require("path"));
async function readConfig() {
    const configPath = path_1.default.join(process.cwd(), 'components.json');
    if (!(await fs_extra_1.default.pathExists(configPath))) {
        return null;
    }
    try {
        return await fs_extra_1.default.readJson(configPath);
    }
    catch (error) {
        throw new Error(`Failed to read components.json: ${error}`);
    }
}
async function writeConfig(config) {
    const configPath = path_1.default.join(process.cwd(), 'components.json');
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
const NOCTA_DESIGN_TOKENS = `@theme {
  --color-nocta-950: oklch(.145 0 0);
  --color-nocta-900: oklch(.205 0 0);
  --color-nocta-800: oklch(.269 0 0);
  --color-nocta-700: oklch(.371 0 0);
  --color-nocta-600: oklch(.444 .011 73.639);
  --color-nocta-500: oklch(.556 0 0);
  --color-nocta-400: oklch(.708 0 0);
  --color-nocta-300: oklch(.87 0 0);
  --color-nocta-200: oklch(.922 0 0);
  --color-nocta-100: oklch(.97 0 0);
  --color-nocta-50: oklch(.985 0 0);
}`;
const NOCTA_TAILWIND_V3_COLORS = {
    nocta: {
        50: 'oklch(.985 0 0)',
        100: 'oklch(.97 0 0)',
        200: 'oklch(.922 0 0)',
        300: 'oklch(.87 0 0)',
        400: 'oklch(.708 0 0)',
        500: 'oklch(.556 0 0)',
        600: 'oklch(.444 .011 73.639)',
        700: 'oklch(.371 0 0)',
        800: 'oklch(.269 0 0)',
        900: 'oklch(.205 0 0)',
        950: 'oklch(.145 0 0)'
    }
};
async function addDesignTokensToCss(cssFilePath) {
    const fullPath = path_1.default.join(process.cwd(), cssFilePath);
    try {
        let cssContent = '';
        if (await fs_extra_1.default.pathExists(fullPath)) {
            cssContent = await fs_extra_1.default.readFile(fullPath, 'utf8');
            // Check if tokens already exist
            if (cssContent.includes('@theme') && cssContent.includes('--color-nocta-')) {
                return false; // Tokens already exist
            }
        }
        // Add tokens at the beginning of the file
        const newContent = `${NOCTA_DESIGN_TOKENS}\n\n${cssContent}`;
        await fs_extra_1.default.ensureDir(path_1.default.dirname(fullPath));
        await fs_extra_1.default.writeFile(fullPath, newContent, 'utf8');
        return true;
    }
    catch (error) {
        throw new Error(`Failed to add design tokens to CSS file: ${error}`);
    }
}
async function addDesignTokensToTailwindConfig(configFilePath) {
    const fullPath = path_1.default.join(process.cwd(), configFilePath);
    try {
        let configContent = '';
        if (await fs_extra_1.default.pathExists(fullPath)) {
            configContent = await fs_extra_1.default.readFile(fullPath, 'utf8');
            // Check if nocta colors already exist
            if (configContent.includes('nocta:') || configContent.includes('"nocta"')) {
                return false; // Tokens already exist
            }
        }
        else {
            // Create a basic tailwind config if it doesn't exist
            configContent = `/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [],
  theme: {
    extend: {},
  },
  plugins: [],
}`;
        }
        // Create properly formatted colors object using the defined constant
        const colorsString = `colors: ${JSON.stringify(NOCTA_TAILWIND_V3_COLORS, null, 8).replace(/^/gm, '      ').trim()}`;
        // Parse and modify the config
        let modifiedContent = configContent;
        // Find the theme.extend section and add colors
        if (modifiedContent.includes('theme:') && modifiedContent.includes('extend:')) {
            // Add colors to existing extend section
            const extendRegex = /(extend:\s*{)(\s*)(})/;
            if (extendRegex.test(modifiedContent)) {
                modifiedContent = modifiedContent.replace(extendRegex, (match, before, whitespace, after) => {
                    const isEmpty = whitespace.trim() === '';
                    const separator = isEmpty ? '\n      ' : ',\n      ';
                    return `${before}${separator}${colorsString}\n    ${after}`;
                });
            }
        }
        else {
            // Add complete theme.extend section
            const themeRegex = /(theme:\s*{)(\s*)(})/;
            if (themeRegex.test(modifiedContent)) {
                modifiedContent = modifiedContent.replace(themeRegex, (match, before, whitespace, after) => {
                    return `${before}\n    extend: {\n      ${colorsString}\n    },\n  ${after}`;
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
async function rollbackInitChanges() {
    const filesToCheck = [
        'components.json',
        'tailwind.config.js',
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
