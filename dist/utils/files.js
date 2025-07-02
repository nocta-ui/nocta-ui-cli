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
        // Create properly formatted colors object
        const colorsString = `colors: {
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
          950: 'oklch(.145 0 0)',
        },
      }`;
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
