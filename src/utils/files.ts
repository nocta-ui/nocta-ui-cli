import fs from 'fs-extra';
import path, { join } from 'path';
import { Config } from '../types';
import { readFileSync, existsSync } from 'fs';

export async function getInstalledDependencies(): Promise<Record<string, string>> {
  try {
    const packageJsonPath = join(process.cwd(), 'package.json');
    
    if (!existsSync(packageJsonPath)) {
      return {};
    }
    
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    
    // Get dependencies from package.json
    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies
    };
    
    // Try to get actual installed versions from node_modules
    const actualVersions: Record<string, string> = {};
    
    for (const depName of Object.keys(allDeps)) {
      try {
        // Try to get the actual installed version
        const nodeModulesPath = join(process.cwd(), 'node_modules', depName, 'package.json');
        
        if (existsSync(nodeModulesPath)) {
          const depPackageJson = JSON.parse(readFileSync(nodeModulesPath, 'utf8'));
          actualVersions[depName] = depPackageJson.version;
        } else {
          // Fallback to version from package.json
          actualVersions[depName] = allDeps[depName];
        }
      } catch (error) {
        // If we can't read the specific package, use version from package.json
        actualVersions[depName] = allDeps[depName];
      }
    }
    
    return actualVersions;
    
  } catch (error) {
    return {};
  }
}

export async function readConfig(): Promise<Config | null> {
  const configPath = path.join(process.cwd(), 'nocta.config.json');
  
  if (!(await fs.pathExists(configPath))) {
    return null;
  }
  
  try {
    return await fs.readJson(configPath);
  } catch (error) {
    throw new Error(`Failed to read nocta.config.json: ${error}`);
  }
}

export async function writeConfig(config: Config): Promise<void> {
  const configPath = path.join(process.cwd(), 'nocta.config.json');
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

export async function addDesignTokensToCss(cssFilePath: string): Promise<boolean> {
  // Tailwind v4: inject semantic color variables and @theme mapping (see new-config.md)
  const fullPath = path.join(process.cwd(), cssFilePath);

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
    if (await fs.pathExists(fullPath)) {
      cssContent = await fs.readFile(fullPath, 'utf8');
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
      if (line.startsWith('@import')) lastImportIndex = i;
      else if (line && !line.startsWith('@') && !line.startsWith('/*') && !line.startsWith('//')) break;
    }

    // Avoid duplicating @import if it's already present
    const hasImport = /@import\s+["']tailwindcss["'];?/i.test(cssContent);
    const snippet = hasImport
      ? V4_SNIPPET.replace(/@import\s+["']tailwindcss["'];?\s*/i, '').trimStart()
      : V4_SNIPPET;

    let newContent: string;
    if (lastImportIndex >= 0) {
      const beforeImports = lines.slice(0, lastImportIndex + 1);
      const afterImports = lines.slice(lastImportIndex + 1);
      newContent = [...beforeImports, '', snippet, '', ...afterImports].join('\n');
    } else {
      newContent = `${snippet}\n\n${cssContent}`;
    }

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
    const isTypeScript = configFilePath.endsWith('.ts');
    
    if (await fs.pathExists(fullPath)) {
      configContent = await fs.readFile(fullPath, 'utf8');
      
      // Check if semantic colors already exist
      if (configContent.includes('colors:') && configContent.includes('background') && configContent.includes('primary')) {
        return false; // Tokens already exist
      }
    } else {
      // Create a basic tailwind config if it doesn't exist
      if (isTypeScript) {
        configContent = `import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: [],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config;`;
      } else {
        configContent = `/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [],
  theme: {
    extend: {},
  },
  plugins: [],
}`;
      }
    }

    // Semantic colors mapping referencing CSS variables
    const colorsMapping = `background: 'var(--color-background)',
        'background-muted': 'var(--color-background-muted)',
        'background-elevated': 'var(--color-background-elevated)',
        foreground: 'var(--color-foreground)',
        'foreground-muted': 'var(--color-foreground-muted)',
        'foreground-subtle': 'var(--color-foreground-subtle)',
        primary: 'var(--color-primary)',
        'primary-muted': 'var(--color-primary-muted)',
        'primary-foreground': 'var(--color-primary-foreground)',
        border: 'var(--color-border)',
        'border-muted': 'var(--color-border-muted)',
        'border-subtle': 'var(--color-border-subtle)',
        ring: 'var(--color-ring)',
        'ring-offset': 'var(--color-ring-offset)',
        overlay: 'var(--color-overlay)',
        'gradient-primary-start': 'var(--color-gradient-primary-start)',
        'gradient-primary-end': 'var(--color-gradient-primary-end)'`;

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
      // Add semantic colors to existing colors section
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
      
      // Add semantic colors mapping
      const noctaLines = colorsMapping.split('\n').map(line => 
        line ? indentForNocta + line : line
      );
      
      modifiedContent = [
        ...beforeColorsEnd,
        ...noctaLines,
        colorsEndLine,
        ...afterColorsEnd
      ].join('\n');

    } else if (foundExtend && extendEndIndex > -1) {
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
        ...colorsMapping.split('\n').map(line => 
          line ? `${extendIndent}    ${line}` : line
        ),
        `${extendIndent}  }${hasContent ? ',' : ''}`
      ];
      
      modifiedContent = [
        ...beforeExtendEnd,
        ...colorsLines,
        extendEndLine,
        ...afterExtendEnd
      ].join('\n');

    } else {
      // No extend section, add complete theme.extend
      const themeRegex = /(theme:\s*{)(\s*)(})/;
      if (themeRegex.test(modifiedContent)) {
        modifiedContent = modifiedContent.replace(themeRegex, (match, before, whitespace, after) => {
          return `${before}\n    extend: {\n      colors: {\n        ${colorsMapping}\n      }\n    },\n  ${after}`;
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

export async function checkTailwindInstallation(): Promise<{ installed: boolean; version?: string }> {
  try {
    const packageJson = await fs.readJson('package.json');
    const tailwindVersion = packageJson.dependencies?.tailwindcss || packageJson.devDependencies?.tailwindcss;
    
    if (!tailwindVersion) {
      return { installed: false };
    }
    
    // Also check if it exists in node_modules
    const nodeModulesPath = path.join(process.cwd(), 'node_modules', 'tailwindcss');
    const existsInNodeModules = await fs.pathExists(nodeModulesPath);
    
    return { 
      installed: existsInNodeModules, 
      version: tailwindVersion 
    };
  } catch (error) {
    return { installed: false };
  }
}

export async function isTypeScriptProject(): Promise<boolean> {
  try {
    const packageJson = await fs.readJson('package.json');
    const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
    
    // Check if TypeScript is installed
    const hasTypeScript = 'typescript' in dependencies || '@types/node' in dependencies;
    
    // Also check for tsconfig.json
    const hasTsConfig = await fs.pathExists('tsconfig.json');
    
    return hasTypeScript || hasTsConfig;
  } catch (error) {
    return false;
  }
}

export async function getTailwindConfigPath(): Promise<string> {
  const isTs = await isTypeScriptProject();
  
  // Check if tailwind.config.ts exists (preferred for TS projects)
  if (isTs && await fs.pathExists('tailwind.config.ts')) {
    return 'tailwind.config.ts';
  }
  
  // Check if tailwind.config.js exists
  if (await fs.pathExists('tailwind.config.js')) {
    return 'tailwind.config.js';
  }
  
  // Return preferred extension based on project type
  return isTs ? 'tailwind.config.ts' : 'tailwind.config.js';
}

export async function rollbackInitChanges(): Promise<void> {
  const filesToCheck = [
    'nocta.config.json',
    'tailwind.config.js',
    'tailwind.config.ts',
    'lib/utils.ts',
    'src/lib/utils.ts'
  ];
  
  for (const file of filesToCheck) {
    const fullPath = path.join(process.cwd(), file);
    if (await fs.pathExists(fullPath)) {
      try {
        await fs.remove(fullPath);
      } catch (error) {
        // Ignore errors when removing files
      }
    }
  }
}

export interface FrameworkDetection {
  framework: 'nextjs' | 'vite-react' | 'react-router' | 'unknown';
  version?: string;
  details: {
    hasConfig: boolean;
    hasReactDependency: boolean;
    hasFrameworkDependency: boolean;
    appStructure?: 'app-router' | 'pages-router' | 'unknown';
    configFiles: string[];
  };
}

export async function detectFramework(): Promise<FrameworkDetection> {
  try {
    // Read package.json to check dependencies
    let packageJson: any = {};
    try {
      packageJson = await fs.readJson('package.json');
    } catch {
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
      if (await fs.pathExists(config)) {
        foundNextConfigs.push(config);
      }
    }

    const hasNext = 'next' in dependencies;
    if (hasNext || foundNextConfigs.length > 0) {
      // Determine app structure
      let appStructure: 'app-router' | 'pages-router' | 'unknown' = 'unknown';
      if (await fs.pathExists('app') && await fs.pathExists('app/layout.tsx')) {
        appStructure = 'app-router';
      } else if (await fs.pathExists('pages') && (
        await fs.pathExists('pages/_app.tsx') || 
        await fs.pathExists('pages/_app.js') ||
        await fs.pathExists('pages/index.tsx') ||
        await fs.pathExists('pages/index.js')
      )) {
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
      if (await fs.pathExists(config)) {
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
        if (await fs.pathExists(indicator)) {
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
      if (await fs.pathExists(config)) {
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
          if (await fs.pathExists(indicator)) {
            // Check if index.html contains React root
            if (indicator === 'index.html') {
              try {
                const htmlContent = await fs.readFile('index.html', 'utf8');
                if (htmlContent.includes('id="root"') || htmlContent.includes('id=\'root\'')) {
                  isReactProject = true;
                  break;
                }
              } catch {
                // Continue checking other files
              }
            } else {
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
      const craIndicators = ['react-scripts' in dependencies, await fs.pathExists('public/index.html')];
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

  } catch (error) {
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

// Add base CSS variables (:root and .dark) to a CSS file (useful for Tailwind v3)
export async function addBaseCssVariables(cssFilePath: string): Promise<boolean> {
  const fullPath = path.join(process.cwd(), cssFilePath);
  const BASE_VARS = `:root {\n\t--color-background: oklch(0.97 0 0);\n\t--color-background-muted: oklch(0.922 0 0);\n\t--color-background-elevated: oklch(0.87 0 0);\n\t--color-foreground: oklch(0.205 0 0);\n\t--color-foreground-muted: oklch(0.371 0 0);\n\t--color-foreground-subtle: oklch(0.708 0 0);\n\t--color-border: oklch(0.205 0 0);\n\t--color-border-muted: oklch(0.922 0 0);\n\t--color-border-subtle: oklch(0.708 0 0);\n\t--color-ring: oklch(0.205 0 0);\n\t--color-ring-offset: oklch(0.97 0 0);\n\t--color-primary: oklch(0.205 0 0);\n\t--color-primary-foreground: oklch(0.97 0 0);\n\t--color-primary-muted: oklch(0.371 0 0);\n\t--color-overlay: oklch(0.145 0 0);\n\t--color-gradient-primary-start: oklch(0.205 0 0);\n\t--color-gradient-primary-end: oklch(0.371 0 0);\n+}\n\n+.dark {\n\t--color-background: oklch(0.205 0 0);\n\t--color-background-muted: oklch(0.269 0 0);\n\t--color-background-elevated: oklch(0.371 0 0);\n\t--color-foreground: oklch(0.97 0 0);\n\t--color-foreground-muted: oklch(0.87 0 0);\n\t--color-foreground-subtle: oklch(0.556 0 0);\n\t--color-border: oklch(0.97 0 0);\n\t--color-border-muted: oklch(0.269 0 0);\n\t--color-border-subtle: oklch(0.371 0 0);\n\t--color-ring: oklch(0.97 0 0);\n\t--color-ring-offset: oklch(0.205 0 0);\n\t--color-primary: oklch(0.97 0 0);\n\t--color-primary-foreground: oklch(0.205 0 0);\n\t--color-primary-muted: oklch(0.87 0 0);\n\t--color-overlay: oklch(0.145 0 0);\n\t--color-gradient-primary-start: oklch(0.371 0 0);\n\t--color-gradient-primary-end: oklch(0.371 0 0);\n+}`;

  try {
    let cssContent = '';
    if (await fs.pathExists(fullPath)) {
      cssContent = await fs.readFile(fullPath, 'utf8');
      if (cssContent.includes('--color-background') && cssContent.includes('--color-primary')) {
        return false;
      }
    }

    const lines = cssContent.split('\n');
    let lastImportIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('@import')) lastImportIndex = i;
      else if (line && !line.startsWith('@') && !line.startsWith('/*') && !line.startsWith('//')) break;
    }

    let newContent: string;
    if (lastImportIndex >= 0) {
      const before = lines.slice(0, lastImportIndex + 1);
      const after = lines.slice(lastImportIndex + 1);
      newContent = [...before, '', BASE_VARS, '', ...after].join('\n');
    } else {
      newContent = `${BASE_VARS}\n\n${cssContent}`;
    }

    await fs.ensureDir(path.dirname(fullPath));
    await fs.writeFile(fullPath, newContent, 'utf8');
    return true;
  } catch (error) {
    throw new Error(`Failed to add base CSS variables: ${error}`);
  }
}
