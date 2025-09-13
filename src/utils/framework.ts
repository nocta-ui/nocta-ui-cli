import fs from 'fs-extra';

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

export async function isTypeScriptProject(): Promise<boolean> {
  try {
    const packageJson = await fs.readJson('package.json');
    const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };

    const hasTypeScript = 'typescript' in dependencies || '@types/node' in dependencies;
    const hasTsConfig = await fs.pathExists('tsconfig.json');

    return hasTypeScript || hasTsConfig;
  } catch {
    return false;
  }
}

export async function detectFramework(): Promise<FrameworkDetection> {
  try {
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
          configFiles: [],
        },
      };
    }

    const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
    const hasReact = 'react' in dependencies;

    // Next.js
    const nextConfigFiles = ['next.config.js', 'next.config.mjs', 'next.config.ts'];
    const foundNextConfigs: string[] = [];
    for (const config of nextConfigFiles) {
      if (await fs.pathExists(config)) {
        foundNextConfigs.push(config);
      }
    }

    const hasNext = 'next' in dependencies;
    if (hasNext || foundNextConfigs.length > 0) {
      let appStructure: 'app-router' | 'pages-router' | 'unknown' = 'unknown';
      if (await fs.pathExists('app') && await fs.pathExists('app/layout.tsx')) {
        appStructure = 'app-router';
      } else if (
        await fs.pathExists('pages') &&
        (await fs.pathExists('pages/_app.tsx') ||
          await fs.pathExists('pages/_app.js') ||
          await fs.pathExists('pages/index.tsx') ||
          await fs.pathExists('pages/index.js'))
      ) {
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
          configFiles: foundNextConfigs,
        },
      };
    }

    // React Router 7
    const reactRouterConfigFiles = ['react-router.config.ts', 'react-router.config.js'];
    const foundReactRouterConfigs: string[] = [];
    for (const config of reactRouterConfigFiles) {
      if (await fs.pathExists(config)) {
        foundReactRouterConfigs.push(config);
      }
    }

    const hasReactRouter = 'react-router' in dependencies;
    const hasReactRouterDev = '@react-router/dev' in dependencies;

    if (hasReactRouter && hasReact) {
      let isReactRouterFramework = false;

      const reactRouterIndicators = [
        'app/routes.ts',
        'app/root.tsx',
        'app/entry.client.tsx',
        'app/entry.server.tsx',
      ];

      for (const indicator of reactRouterIndicators) {
        if (await fs.pathExists(indicator)) {
          isReactRouterFramework = true;
          break;
        }
      }

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
            configFiles: foundReactRouterConfigs,
          },
        };
      }
    }

    // Vite + React
    const viteConfigFiles = ['vite.config.js', 'vite.config.ts', 'vite.config.mjs'];
    const foundViteConfigs: string[] = [];
    for (const config of viteConfigFiles) {
      if (await fs.pathExists(config)) {
        foundViteConfigs.push(config);
      }
    }

    const hasVite = 'vite' in dependencies;
    const hasViteReactPlugin = '@vitejs/plugin-react' in dependencies || '@vitejs/plugin-react-swc' in dependencies;

    if ((hasVite || foundViteConfigs.length > 0) && hasReact) {
      let isReactProject = hasViteReactPlugin;

      if (!isReactProject) {
        const reactIndicators = ['src/App.tsx', 'src/App.jsx', 'src/main.tsx', 'src/main.jsx', 'index.html'];
        for (const indicator of reactIndicators) {
          if (await fs.pathExists(indicator)) {
            if (indicator === 'index.html') {
              try {
                const htmlContent = await fs.readFile('index.html', 'utf8');
                if (htmlContent.includes('id="root"') || htmlContent.includes("id='root'")) {
                  isReactProject = true;
                  break;
                }
              } catch {
                // ignore
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
            configFiles: foundViteConfigs,
          },
        };
      }
    }

    // CRA or custom
    if (hasReact) {
      const craIndicators = ['react-scripts' in dependencies, await fs.pathExists('public/index.html')];
      if (craIndicators.some(Boolean)) {
        return {
          framework: 'unknown',
          details: {
            hasConfig: false,
            hasReactDependency: true,
            hasFrameworkDependency: false,
            configFiles: [],
          },
        };
      }
    }

    return {
      framework: 'unknown',
      details: {
        hasConfig: false,
        hasReactDependency: hasReact,
        hasFrameworkDependency: false,
        configFiles: [],
      },
    };
  } catch {
    return {
      framework: 'unknown',
      details: {
        hasConfig: false,
        hasReactDependency: false,
        hasFrameworkDependency: false,
        configFiles: [],
      },
    };
  }
}

