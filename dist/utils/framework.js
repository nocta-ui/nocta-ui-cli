"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTypeScriptProject = isTypeScriptProject;
exports.detectFramework = detectFramework;
const fs_extra_1 = __importDefault(require("fs-extra"));
async function isTypeScriptProject() {
    try {
        const packageJson = await fs_extra_1.default.readJson('package.json');
        const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
        const hasTypeScript = 'typescript' in dependencies || '@types/node' in dependencies;
        const hasTsConfig = await fs_extra_1.default.pathExists('tsconfig.json');
        return hasTypeScript || hasTsConfig;
    }
    catch {
        return false;
    }
}
async function detectFramework() {
    try {
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
                    configFiles: [],
                },
            };
        }
        const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
        const hasReact = 'react' in dependencies;
        // Next.js
        const nextConfigFiles = ['next.config.js', 'next.config.mjs', 'next.config.ts'];
        const foundNextConfigs = [];
        for (const config of nextConfigFiles) {
            if (await fs_extra_1.default.pathExists(config)) {
                foundNextConfigs.push(config);
            }
        }
        const hasNext = 'next' in dependencies;
        if (hasNext || foundNextConfigs.length > 0) {
            let appStructure = 'unknown';
            if (await fs_extra_1.default.pathExists('app') && await fs_extra_1.default.pathExists('app/layout.tsx')) {
                appStructure = 'app-router';
            }
            else if (await fs_extra_1.default.pathExists('pages') &&
                (await fs_extra_1.default.pathExists('pages/_app.tsx') ||
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
                    configFiles: foundNextConfigs,
                },
            };
        }
        // React Router 7
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
            let isReactRouterFramework = false;
            const reactRouterIndicators = [
                'app/routes.ts',
                'app/root.tsx',
                'app/entry.client.tsx',
                'app/entry.server.tsx',
            ];
            for (const indicator of reactRouterIndicators) {
                if (await fs_extra_1.default.pathExists(indicator)) {
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
        const foundViteConfigs = [];
        for (const config of viteConfigFiles) {
            if (await fs_extra_1.default.pathExists(config)) {
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
                    if (await fs_extra_1.default.pathExists(indicator)) {
                        if (indicator === 'index.html') {
                            try {
                                const htmlContent = await fs_extra_1.default.readFile('index.html', 'utf8');
                                if (htmlContent.includes('id="root"') || htmlContent.includes("id='root'")) {
                                    isReactProject = true;
                                    break;
                                }
                            }
                            catch {
                                // ignore
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
                        configFiles: foundViteConfigs,
                    },
                };
            }
        }
        // CRA or custom
        if (hasReact) {
            const craIndicators = ['react-scripts' in dependencies, await fs_extra_1.default.pathExists('public/index.html')];
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
    }
    catch {
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
