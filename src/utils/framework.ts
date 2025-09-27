import fs from "fs-extra";

interface PackageJson {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	[key: string]: unknown;
}

export interface FrameworkDetection {
	framework: "nextjs" | "vite-react" | "react-router" | "unknown";
	version?: string;
	details: {
		hasConfig: boolean;
		hasReactDependency: boolean;
		hasFrameworkDependency: boolean;
		appStructure?: "app-router" | "pages-router" | "unknown";
		configFiles: string[];
	};
}

export async function isTypeScriptProject(): Promise<boolean> {
	try {
		const packageJson = await fs.readJson("package.json");
		const dependencies = {
			...packageJson.dependencies,
			...packageJson.devDependencies,
		};

		const hasTypeScript =
			"typescript" in dependencies || "@types/node" in dependencies;
		const hasTsConfig = await fs.pathExists("tsconfig.json");

		return hasTypeScript || hasTsConfig;
	} catch {
		return false;
	}
}

export async function detectFramework(): Promise<FrameworkDetection> {
	try {
		let packageJson: PackageJson = {};
		try {
			packageJson = (await fs.readJson("package.json")) as PackageJson;
		} catch {
			return {
				framework: "unknown",
				details: {
					hasConfig: false,
					hasReactDependency: false,
					hasFrameworkDependency: false,
					configFiles: [],
				},
			};
		}

		const dependencies = {
			...packageJson.dependencies,
			...packageJson.devDependencies,
		};
		const hasReact = "react" in dependencies;

		const nextConfigFiles = [
			"next.config.js",
			"next.config.mjs",
			"next.config.ts",
			"next.config.cjs",
		];
		const foundNextConfigs: string[] = [];
		for (const config of nextConfigFiles) {
			if (await fs.pathExists(config)) {
				foundNextConfigs.push(config);
			}
		}

		const hasNext = "next" in dependencies;
		if (hasNext || foundNextConfigs.length > 0) {
			let appStructure: "app-router" | "pages-router" | "unknown" = "unknown";

			const appRouterPaths = [
				"app/layout.tsx",
				"app/layout.ts",
				"app/layout.jsx",
				"app/layout.js",
				"src/app/layout.tsx",
				"src/app/layout.ts",
				"src/app/layout.jsx",
				"src/app/layout.js",
			];

			for (const layoutPath of appRouterPaths) {
				if (await fs.pathExists(layoutPath)) {
					appStructure = "app-router";
					break;
				}
			}

			if (appStructure === "unknown") {
				const pagesRouterPaths = [
					"pages/_app.tsx",
					"pages/_app.ts",
					"pages/_app.jsx",
					"pages/_app.js",
					"pages/index.tsx",
					"pages/index.ts",
					"pages/index.jsx",
					"pages/index.js",
					"src/pages/_app.tsx",
					"src/pages/_app.ts",
					"src/pages/_app.jsx",
					"src/pages/_app.js",
					"src/pages/index.tsx",
					"src/pages/index.ts",
					"src/pages/index.jsx",
					"src/pages/index.js",
				];

				for (const pagePath of pagesRouterPaths) {
					if (await fs.pathExists(pagePath)) {
						appStructure = "pages-router";
						break;
					}
				}
			}

			return {
				framework: "nextjs",
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

		const reactRouterConfigFiles = [
			"react-router.config.ts",
			"react-router.config.js",
		];
		const foundReactRouterConfigs: string[] = [];
		for (const config of reactRouterConfigFiles) {
			if (await fs.pathExists(config)) {
				foundReactRouterConfigs.push(config);
			}
		}

		const hasReactRouter = "react-router" in dependencies;
		const hasReactRouterDev = "@react-router/dev" in dependencies;
		const hasRemixRunReact = "@remix-run/react" in dependencies;

		if ((hasReactRouter || hasReactRouterDev || hasRemixRunReact) && hasReact) {
			let isReactRouterFramework = false;

			const reactRouterIndicators = [
				"app/routes.ts",
				"app/routes.tsx",
				"app/routes.js",
				"app/routes.jsx",
				"app/root.tsx",
				"app/root.ts",
				"app/root.jsx",
				"app/root.js",
				"app/entry.client.tsx",
				"app/entry.client.ts",
				"app/entry.client.jsx",
				"app/entry.client.js",
				"app/entry.server.tsx",
				"app/entry.server.ts",
				"app/entry.server.jsx",
				"app/entry.server.js",
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

			if (
				hasRemixRunReact &&
				!(await fs.pathExists("remix.config.js")) &&
				!(await fs.pathExists("remix.config.ts"))
			) {
				isReactRouterFramework = true;
			}

			if (isReactRouterFramework) {
				return {
					framework: "react-router",
					version:
						dependencies["react-router"] ||
						dependencies["@react-router/dev"] ||
						dependencies["@remix-run/react"],
					details: {
						hasConfig: foundReactRouterConfigs.length > 0,
						hasReactDependency: hasReact,
						hasFrameworkDependency:
							hasReactRouter || hasReactRouterDev || hasRemixRunReact,
						configFiles: foundReactRouterConfigs,
					},
				};
			}
		}

		const viteConfigFiles = [
			"vite.config.js",
			"vite.config.ts",
			"vite.config.mjs",
			"vite.config.cjs",
		];
		const foundViteConfigs: string[] = [];
		for (const config of viteConfigFiles) {
			if (await fs.pathExists(config)) {
				foundViteConfigs.push(config);
			}
		}

		const hasVite = "vite" in dependencies;
		const hasViteReactPlugin =
			"@vitejs/plugin-react" in dependencies ||
			"@vitejs/plugin-react-swc" in dependencies;

		if ((hasVite || foundViteConfigs.length > 0) && hasReact) {
			let isReactProject = false;

			if (hasViteReactPlugin) {
				isReactProject = true;
			}

			if (!isReactProject) {
				const viteReactIndicators = [
					"src/App.tsx",
					"src/App.jsx",
					"src/App.ts",
					"src/App.js",
					"src/main.tsx",
					"src/main.jsx",
					"src/main.ts",
					"src/main.js",
					"src/index.tsx",
					"src/index.jsx",
					"src/index.ts",
					"src/index.js",
				];

				for (const indicator of viteReactIndicators) {
					if (await fs.pathExists(indicator)) {
						isReactProject = true;
						break;
					}
				}
			}

			if (!isReactProject && (await fs.pathExists("index.html"))) {
				try {
					const htmlContent = await fs.readFile("index.html", "utf8");
					const hasReactRoot =
						htmlContent.includes('id="root"') ||
						htmlContent.includes("id='root'");
					const hasViteScript =
						htmlContent.includes("/src/main.") ||
						htmlContent.includes("/src/index.") ||
						htmlContent.includes('type="module"');

					if (hasReactRoot && hasViteScript) {
						isReactProject = true;
					}
				} catch {
					// ignore
				}
			}

			if (isReactProject) {
				return {
					framework: "vite-react",
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

		if (hasReact) {
			const craIndicators = [
				"react-scripts" in dependencies,
				await fs.pathExists("public/index.html"),
			];
			if (craIndicators.some(Boolean)) {
				return {
					framework: "unknown",
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
			framework: "unknown",
			details: {
				hasConfig: false,
				hasReactDependency: hasReact,
				hasFrameworkDependency: false,
				configFiles: [],
			},
		};
	} catch {
		return {
			framework: "unknown",
			details: {
				hasConfig: false,
				hasReactDependency: false,
				hasFrameworkDependency: false,
				configFiles: [],
			},
		};
	}
}
