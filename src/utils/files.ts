import fs from 'fs-extra';
import path from 'path';
import { Config } from '../types';

export async function readConfig(): Promise<Config | null> {
  const configPath = path.join(process.cwd(), 'components.json');
  
  if (!(await fs.pathExists(configPath))) {
    return null;
  }
  
  try {
    return await fs.readJson(configPath);
  } catch (error) {
    throw new Error(`Failed to read components.json: ${error}`);
  }
}

export async function writeConfig(config: Config): Promise<void> {
  const configPath = path.join(process.cwd(), 'components.json');
  await fs.writeJson(configPath, config, { spaces: 2 });
}

export async function fileExists(filePath: string): Promise<boolean> {
  const fullPath = path.join(process.cwd(), filePath);
  return await fs.pathExists(fullPath);
}

export async function writeComponentFile(filePath: string, content: string): Promise<void> {
  const fullPath = path.join(process.cwd(), filePath);
  await fs.ensureDir(path.dirname(fullPath));
  await fs.writeFile(fullPath, content, 'utf8');
}

export function resolveComponentPath(componentFilePath: string, config: Config): string {
  const fileName = path.basename(componentFilePath);
  
  const componentFolder = path.basename(path.dirname(componentFilePath));
  
  return path.join(config.aliases.components, 'ui', fileName);
}

export async function installDependencies(dependencies: Record<string, string>): Promise<void> {
  const deps = Object.keys(dependencies);
  if (deps.length === 0) return;

  const { execSync } = require('child_process');
  
  let packageManager = 'npm';
  if (await fs.pathExists('yarn.lock')) {
    packageManager = 'yarn';
  } else if (await fs.pathExists('pnpm-lock.yaml')) {
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

export async function addDesignTokensToCss(cssFilePath: string): Promise<boolean> {
  const fullPath = path.join(process.cwd(), cssFilePath);
  
  try {
    let cssContent = '';
    if (await fs.pathExists(fullPath)) {
      cssContent = await fs.readFile(fullPath, 'utf8');
      
      // Check if tokens already exist
      if (cssContent.includes('@theme') && cssContent.includes('--color-nocta-')) {
        return false; // Tokens already exist
      }
    }
    
    // Add tokens at the beginning of the file
    const newContent = `${NOCTA_DESIGN_TOKENS}\n\n${cssContent}`;
    
    await fs.ensureDir(path.dirname(fullPath));
    await fs.writeFile(fullPath, newContent, 'utf8');
    return true;
  } catch (error) {
    throw new Error(`Failed to add design tokens to CSS file: ${error}`);
  }
}

export async function addDesignTokensToTailwindConfig(configFilePath: string): Promise<boolean> {
  const fullPath = path.join(process.cwd(), configFilePath);
  
  try {
    let configContent = '';
    if (await fs.pathExists(fullPath)) {
      configContent = await fs.readFile(fullPath, 'utf8');
      
      // Check if nocta colors already exist
      if (configContent.includes('nocta:') || configContent.includes('"nocta"')) {
        return false; // Tokens already exist
      }
    } else {
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
    } else {
      // Add complete theme.extend section
      const themeRegex = /(theme:\s*{)(\s*)(})/;
      if (themeRegex.test(modifiedContent)) {
        modifiedContent = modifiedContent.replace(themeRegex, (match, before, whitespace, after) => {
          return `${before}\n    extend: {\n      ${colorsString}\n    },\n  ${after}`;
        });
      }
    }

    await fs.ensureDir(path.dirname(fullPath));
    await fs.writeFile(fullPath, modifiedContent, 'utf8');
    return true;
  } catch (error) {
    throw new Error(`Failed to add design tokens to Tailwind config: ${error}`);
  }
}