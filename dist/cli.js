#!/usr/bin/env node
import fs9, { existsSync, readFileSync } from 'fs';
import chalk2 from 'chalk';
import { Command } from 'commander';
import inquirer from 'inquirer';
import ora from 'ora';
import semver, { minVersion, satisfies, gte } from 'semver';
import path, { join } from 'path';
import fs4 from 'fs-extra';
import { execSync } from 'child_process';

function getCacheBaseDir() {
  const custom = process.env.NOCTA_CACHE_DIR;
  if (custom && custom.trim()) return custom;
  return path.join(process.cwd(), ".nocta-cache");
}
function resolveCachePath(relPath) {
  const safeRel = relPath.replace(/^\/+/, "");
  return path.join(getCacheBaseDir(), safeRel);
}
async function ensureDirFor(filePath) {
  await fs4.ensureDir(path.dirname(filePath));
}
async function readCacheText(relPath, ttlMs, opts) {
  const fullPath = resolveCachePath(relPath);
  if (!await fs4.pathExists(fullPath)) return null;
  try {
    if (!opts?.acceptStale && typeof ttlMs === "number") {
      const stat = await fs4.stat(fullPath);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs > ttlMs) return null;
    }
    return await fs4.readFile(fullPath, "utf8");
  } catch {
    return null;
  }
}
async function writeCacheText(relPath, content) {
  const fullPath = resolveCachePath(relPath);
  await ensureDirFor(fullPath);
  await fs4.writeFile(fullPath, content, "utf8");
}
async function readConfig() {
  const configPath = path.join(process.cwd(), "nocta.config.json");
  if (!await fs4.pathExists(configPath)) {
    return null;
  }
  try {
    return await fs4.readJson(configPath);
  } catch (error) {
    throw new Error(`Failed to read nocta.config.json: ${error}`);
  }
}
async function writeConfig(config) {
  const configPath = path.join(process.cwd(), "nocta.config.json");
  const configWithSchema = {
    $schema: "https://nocta-ui.com/registry/config-schema.json",
    ...config
  };
  configWithSchema.$schema = "https://nocta-ui.com/registry/config-schema.json";
  await fs4.writeJson(configPath, configWithSchema, { spaces: 2 });
}
async function getInstalledDependencies() {
  try {
    const packageJsonPath = join(process.cwd(), "package.json");
    if (!existsSync(packageJsonPath)) {
      return {};
    }
    const packageJson2 = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    const allDeps = {
      ...packageJson2.dependencies,
      ...packageJson2.devDependencies
    };
    const actualVersions = {};
    for (const depName of Object.keys(allDeps)) {
      try {
        const nodeModulesPath = join(
          process.cwd(),
          "node_modules",
          depName,
          "package.json"
        );
        if (existsSync(nodeModulesPath)) {
          const depPackageJson = JSON.parse(
            readFileSync(nodeModulesPath, "utf8")
          );
          actualVersions[depName] = depPackageJson.version;
        } else {
          actualVersions[depName] = allDeps[depName];
        }
      } catch {
        actualVersions[depName] = allDeps[depName];
      }
    }
    return actualVersions;
  } catch {
    return {};
  }
}
async function installDependencies(dependencies) {
  const deps = Object.keys(dependencies);
  if (deps.length === 0) return;
  let packageManager = "npm";
  if (await fs4.pathExists("yarn.lock")) {
    packageManager = "yarn";
  } else if (await fs4.pathExists("pnpm-lock.yaml")) {
    packageManager = "pnpm";
  }
  const depsWithVersions = deps.map(
    (depName) => `${depName}@${dependencies[depName]}`
  );
  const installCmd = packageManager === "yarn" ? `yarn add ${depsWithVersions.join(" ")}` : packageManager === "pnpm" ? `pnpm add ${depsWithVersions.join(" ")}` : `npm install ${depsWithVersions.join(" ")}`;
  console.log(`Installing dependencies with ${packageManager}...`);
  execSync(installCmd, { stdio: "inherit" });
}
async function checkProjectRequirements(requirements) {
  const installed = await getInstalledDependencies();
  const issues = [];
  for (const [name, requiredRange] of Object.entries(requirements)) {
    const installedSpec = installed[name];
    if (!installedSpec) {
      issues.push({
        name,
        required: requiredRange,
        reason: "missing"
      });
      continue;
    }
    const modulePackagePath = join(
      process.cwd(),
      "node_modules",
      ...name.split("/"),
      "package.json"
    );
    if (!existsSync(modulePackagePath)) {
      issues.push({
        name,
        required: requiredRange,
        declared: installedSpec,
        reason: "missing"
      });
      continue;
    }
    const resolvedVersion = minVersion(installedSpec);
    const minimumRequired = minVersion(requiredRange);
    const rangeSatisfied = resolvedVersion ? satisfies(resolvedVersion, requiredRange, {
      includePrerelease: true
    }) : false;
    const higherVersionSatisfied = resolvedVersion && minimumRequired ? gte(resolvedVersion, minimumRequired) : false;
    if (!resolvedVersion || !rangeSatisfied && !higherVersionSatisfied) {
      const normalizedVersion = resolvedVersion?.version;
      issues.push({
        name,
        required: requiredRange,
        installed: normalizedVersion,
        declared: normalizedVersion && normalizedVersion === installedSpec ? void 0 : installedSpec,
        reason: resolvedVersion ? "outdated" : "unknown"
      });
    }
  }
  return issues;
}
async function detectFramework() {
  try {
    let packageJson2 = {};
    try {
      packageJson2 = await fs4.readJson("package.json");
    } catch {
      return {
        framework: "unknown",
        details: {
          hasConfig: false,
          hasReactDependency: false,
          hasFrameworkDependency: false,
          configFiles: []
        }
      };
    }
    const dependencies = {
      ...packageJson2.dependencies,
      ...packageJson2.devDependencies
    };
    const hasReact = "react" in dependencies;
    const nextConfigFiles = [
      "next.config.js",
      "next.config.mjs",
      "next.config.ts",
      "next.config.cjs"
    ];
    const foundNextConfigs = [];
    for (const config of nextConfigFiles) {
      if (await fs4.pathExists(config)) {
        foundNextConfigs.push(config);
      }
    }
    const hasNext = "next" in dependencies;
    if (hasNext || foundNextConfigs.length > 0) {
      let appStructure = "unknown";
      const appRouterPaths = [
        "app/layout.tsx",
        "app/layout.ts",
        "app/layout.jsx",
        "app/layout.js",
        "src/app/layout.tsx",
        "src/app/layout.ts",
        "src/app/layout.jsx",
        "src/app/layout.js"
      ];
      for (const layoutPath of appRouterPaths) {
        if (await fs4.pathExists(layoutPath)) {
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
          "src/pages/index.js"
        ];
        for (const pagePath of pagesRouterPaths) {
          if (await fs4.pathExists(pagePath)) {
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
          configFiles: foundNextConfigs
        }
      };
    }
    const reactRouterConfigFiles = [
      "react-router.config.ts",
      "react-router.config.js"
    ];
    const foundReactRouterConfigs = [];
    for (const config of reactRouterConfigFiles) {
      if (await fs4.pathExists(config)) {
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
        "app/entry.server.js"
      ];
      for (const indicator of reactRouterIndicators) {
        if (await fs4.pathExists(indicator)) {
          isReactRouterFramework = true;
          break;
        }
      }
      if (hasReactRouterDev || foundReactRouterConfigs.length > 0) {
        isReactRouterFramework = true;
      }
      if (hasRemixRunReact && !await fs4.pathExists("remix.config.js") && !await fs4.pathExists("remix.config.ts")) {
        isReactRouterFramework = true;
      }
      if (isReactRouterFramework) {
        return {
          framework: "react-router",
          version: dependencies["react-router"] || dependencies["@react-router/dev"] || dependencies["@remix-run/react"],
          details: {
            hasConfig: foundReactRouterConfigs.length > 0,
            hasReactDependency: hasReact,
            hasFrameworkDependency: hasReactRouter || hasReactRouterDev || hasRemixRunReact,
            configFiles: foundReactRouterConfigs
          }
        };
      }
    }
    const viteConfigFiles = [
      "vite.config.js",
      "vite.config.ts",
      "vite.config.mjs",
      "vite.config.cjs"
    ];
    const foundViteConfigs = [];
    for (const config of viteConfigFiles) {
      if (await fs4.pathExists(config)) {
        foundViteConfigs.push(config);
      }
    }
    const hasVite = "vite" in dependencies;
    const hasViteReactPlugin = "@vitejs/plugin-react" in dependencies || "@vitejs/plugin-react-swc" in dependencies;
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
          "src/index.js"
        ];
        for (const indicator of viteReactIndicators) {
          if (await fs4.pathExists(indicator)) {
            isReactProject = true;
            break;
          }
        }
      }
      if (!isReactProject && await fs4.pathExists("index.html")) {
        try {
          const htmlContent = await fs4.readFile("index.html", "utf8");
          const hasReactRoot = htmlContent.includes('id="root"') || htmlContent.includes("id='root'");
          const hasViteScript = htmlContent.includes("/src/main.") || htmlContent.includes("/src/index.") || htmlContent.includes('type="module"');
          if (hasReactRoot && hasViteScript) {
            isReactProject = true;
          }
        } catch {
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
            configFiles: foundViteConfigs
          }
        };
      }
    }
    if (hasReact) {
      const craIndicators = [
        "react-scripts" in dependencies,
        await fs4.pathExists("public/index.html")
      ];
      if (craIndicators.some(Boolean)) {
        return {
          framework: "unknown",
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
      framework: "unknown",
      details: {
        hasConfig: false,
        hasReactDependency: hasReact,
        hasFrameworkDependency: false,
        configFiles: []
      }
    };
  } catch {
    return {
      framework: "unknown",
      details: {
        hasConfig: false,
        hasReactDependency: false,
        hasFrameworkDependency: false,
        configFiles: []
      }
    };
  }
}
async function fileExists(filePath) {
  const fullPath = path.join(process.cwd(), filePath);
  return await fs4.pathExists(fullPath);
}
async function writeComponentFile(filePath, content) {
  const fullPath = path.join(process.cwd(), filePath);
  await fs4.ensureDir(path.dirname(fullPath));
  await fs4.writeFile(fullPath, content, "utf8");
}
function resolveComponentPath(componentFilePath, config) {
  const fileName = path.basename(componentFilePath);
  return path.join(config.aliases.components, fileName);
}

// src/utils/registry.ts
var REGISTRY_BASE_URL = "https://nocta-ui.com/registry";
var REGISTRY_URL = `${REGISTRY_BASE_URL}/registry.json`;
var COMPONENTS_MANIFEST_PATH = "components.json";
var REGISTRY_TTL_MS = Number(
  process.env.NOCTA_CACHE_TTL_MS || 10 * 60 * 1e3
);
var ASSET_TTL_MS = Number(
  process.env.NOCTA_ASSET_CACHE_TTL_MS || 24 * 60 * 60 * 1e3
);
var componentsManifestPromise = null;
async function getRegistry() {
  try {
    const response = await fetch(REGISTRY_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch registry: ${response.statusText}`);
    }
    const text = await response.text();
    try {
      await writeCacheText("registry/registry.json", text);
    } catch {
    }
    return JSON.parse(text);
  } catch (error) {
    const cached = await readCacheText(
      "registry/registry.json",
      REGISTRY_TTL_MS,
      { acceptStale: true }
    );
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
      }
    }
    throw new Error(`Failed to load registry: ${error}`);
  }
}
async function getComponent(name) {
  const registry = await getRegistry();
  const component = registry.components[name];
  if (!component) {
    throw new Error(`Component "${name}" not found`);
  }
  return component;
}
async function getComponentFile(filePath) {
  const fileName = filePath.split("/").pop();
  if (!fileName) {
    throw new Error(`Invalid component file path: ${filePath}`);
  }
  try {
    const manifest = await getComponentsManifest();
    const encodedComponent = manifest[fileName];
    if (!encodedComponent) {
      throw new Error(
        `Component file "${fileName}" not found in registry manifest`
      );
    }
    return Buffer.from(encodedComponent, "base64").toString("utf8");
  } catch (error) {
    throw new Error(`Failed to load component file: ${error}`);
  }
}
async function getComponentsManifest() {
  if (!componentsManifestPromise) {
    componentsManifestPromise = (async () => {
      const manifestContent = await getRegistryAsset(COMPONENTS_MANIFEST_PATH);
      try {
        return JSON.parse(manifestContent);
      } catch (error) {
        throw new Error(`Invalid components manifest JSON: ${error}`);
      }
    })();
  }
  return componentsManifestPromise;
}
async function listComponents() {
  const registry = await getRegistry();
  return Object.values(registry.components);
}
async function getRegistryAsset(assetPath) {
  const normalizedPath = assetPath.replace(/^\/+/, "");
  const url = `${REGISTRY_BASE_URL}/${normalizedPath}`;
  const cacheRel = `assets/${normalizedPath}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch registry asset "${assetPath}": ${response.statusText}`
      );
    }
    const text = await response.text();
    try {
      await writeCacheText(cacheRel, text);
    } catch {
    }
    return text;
  } catch (error) {
    const cached = await readCacheText(cacheRel, ASSET_TTL_MS, {
      acceptStale: true
    });
    if (cached) return cached;
    throw new Error(`Failed to load registry asset "${assetPath}": ${error}`);
  }
}
async function getCategories() {
  const registry = await getRegistry();
  return registry.categories;
}
async function getComponentWithDependencies(name, visited = /* @__PURE__ */ new Set()) {
  if (visited.has(name)) {
    return [];
  }
  visited.add(name);
  const component = await getComponent(name);
  const result = [component];
  if (component.internalDependencies && component.internalDependencies.length > 0) {
    for (const depName of component.internalDependencies) {
      const depComponents = await getComponentWithDependencies(
        depName,
        visited
      );
      result.unshift(...depComponents);
    }
  }
  const uniqueComponents = [];
  const seenNames = /* @__PURE__ */ new Set();
  for (const comp of result) {
    if (!seenNames.has(comp.name)) {
      seenNames.add(comp.name);
      uniqueComponents.push(comp);
    }
  }
  return uniqueComponents;
}
async function rollbackInitChanges(paths = []) {
  const uniquePaths = Array.from(new Set(paths));
  for (const targetPath of uniquePaths) {
    const normalizedPath = path.isAbsolute(targetPath) ? targetPath : path.join(process.cwd(), targetPath);
    if (!await fs4.pathExists(normalizedPath)) {
      continue;
    }
    try {
      await fs4.remove(normalizedPath);
    } catch {
    }
  }
}
var CSS_REGISTRY_PATH = "css/index.css";
async function addDesignTokensToCss(cssFilePath) {
  const fullPath = path.join(process.cwd(), cssFilePath);
  const tailwindImportPattern = /@import\s+["']tailwindcss["'];?/i;
  try {
    const registryCss = await getRegistryAsset(CSS_REGISTRY_PATH);
    const trimmedRegistryCss = registryCss.trimStart();
    let cssContent = "";
    if (await fs4.pathExists(fullPath)) {
      cssContent = await fs4.readFile(fullPath, "utf8");
      const hasRegistryTheme = cssContent.includes("NOCTA CSS THEME VARIABLES");
      if (hasRegistryTheme) {
        return false;
      }
    }
    const lines = cssContent.split("\n");
    let lastImportIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("@import")) lastImportIndex = i;
      else if (line && !line.startsWith("@") && !line.startsWith("/*") && !line.startsWith("//"))
        break;
    }
    const hasImport = tailwindImportPattern.test(cssContent);
    const normalizedSnippet = hasImport ? trimmedRegistryCss.replace(tailwindImportPattern, "").trimStart() : trimmedRegistryCss;
    let newContent;
    if (lastImportIndex >= 0) {
      const beforeImports = lines.slice(0, lastImportIndex + 1);
      const afterImports = lines.slice(lastImportIndex + 1);
      newContent = [
        ...beforeImports,
        "",
        normalizedSnippet,
        "",
        ...afterImports
      ].join("\n");
    } else {
      newContent = `${normalizedSnippet}

${cssContent}`;
    }
    await fs4.ensureDir(path.dirname(fullPath));
    await fs4.writeFile(fullPath, newContent, "utf8");
    return true;
  } catch (error) {
    throw new Error(`Failed to add design tokens to CSS file: ${error}`);
  }
}
async function checkTailwindInstallation() {
  try {
    const packageJson2 = await fs4.readJson("package.json");
    const declared = packageJson2.dependencies?.tailwindcss || packageJson2.devDependencies?.tailwindcss;
    if (!declared) {
      return { installed: false };
    }
    const pkgPath = path.join(
      process.cwd(),
      "node_modules",
      "tailwindcss",
      "package.json"
    );
    if (await fs4.pathExists(pkgPath)) {
      try {
        const tailwindPkg = await fs4.readJson(pkgPath);
        const actualVersion = tailwindPkg?.version;
        if (actualVersion) {
          return { installed: true, version: actualVersion };
        }
      } catch {
      }
      return { installed: true, version: declared };
    }
    return { installed: false };
  } catch {
    return { installed: false };
  }
}

// src/commands/add.ts
function joinImportPath(prefix, importPath) {
  const normalizedPrefix = prefix.replace(/\/+$/, "");
  const normalizedPath = importPath.replace(/^\/+/, "");
  if (!normalizedPath) {
    return normalizedPrefix;
  }
  return `${normalizedPrefix}/${normalizedPath}`;
}
function normalizeComponentContent(content, aliasPrefix) {
  const sanitizedPrefix = aliasPrefix || "@";
  return content.replace(
    /(['"])@\/([^'"\n]+)(['"])/g,
    (_match, openQuote, importPath, closeQuote) => {
      let normalizedPath = importPath;
      if (normalizedPath.startsWith("app/")) {
        normalizedPath = normalizedPath.slice(4);
      } else if (normalizedPath.startsWith("src/")) {
        normalizedPath = normalizedPath.slice(4);
      }
      if (normalizedPath.startsWith("./")) {
        normalizedPath = normalizedPath.slice(2);
      }
      return `${openQuote}${joinImportPath(
        sanitizedPrefix,
        normalizedPath
      )}${closeQuote}`;
    }
  );
}
async function add(componentNames, options = {}) {
  const isDryRun = Boolean(options?.dryRun);
  if (componentNames.length === 0) {
    console.log(chalk2.red("Please specify at least one component name"));
    console.log(
      chalk2.yellow(
        "Usage: npx nocta-ui add <component1> [component2] [component3] ..."
      )
    );
    return;
  }
  const spinner = ora(
    `${isDryRun ? "[dry-run] " : ""}Adding ${componentNames.length > 1 ? `${componentNames.length} components` : componentNames[0]}...`
  ).start();
  try {
    const config = await readConfig();
    if (!config) {
      spinner.fail("Project not initialized");
      console.log(chalk2.red("nocta.config.json not found"));
      console.log(chalk2.yellow('Run "npx nocta-ui init" first'));
      return;
    }
    spinner.text = "Detecting framework...";
    const frameworkDetection = await detectFramework();
    const componentAliasPrefix = config.aliasPrefixes?.components !== void 0 ? config.aliasPrefixes.components : frameworkDetection.framework === "react-router" ? "~" : "@";
    spinner.text = "Fetching components and dependencies...";
    const allComponentsMap = /* @__PURE__ */ new Map();
    const processedComponents = /* @__PURE__ */ new Set();
    for (const componentName of componentNames) {
      try {
        const componentsWithDeps = await getComponentWithDependencies(componentName);
        for (const component of componentsWithDeps) {
          if (!processedComponents.has(component.name)) {
            allComponentsMap.set(component.name, component);
            processedComponents.add(component.name);
          }
        }
      } catch (error) {
        spinner.fail(`Failed to fetch component: ${componentName}`);
        if (error instanceof Error && error.message.includes("not found")) {
          console.log(chalk2.red(`Component "${componentName}" not found`));
          console.log(
            chalk2.yellow('Run "npx nocta-ui list" to see available components')
          );
        }
        throw error;
      }
    }
    const allComponents = Array.from(allComponentsMap.values());
    const requestedComponents = componentNames.map((name) => {
      return allComponents.find((c) => {
        const registryKey = c.files[0].path.split("/").pop()?.replace(".tsx", "") || "";
        return registryKey.toLowerCase() === name.toLowerCase() || c.name.toLowerCase() === name.toLowerCase();
      });
    }).filter(
      (component) => component !== void 0
    );
    const requestedComponentNames = requestedComponents.map((c) => c.name);
    const dependencies = allComponents.filter(
      (c) => !requestedComponentNames.includes(c.name)
    );
    spinner.stop();
    console.log(
      chalk2.blue(
        `Installing ${componentNames.length} component${componentNames.length > 1 ? "s" : ""}:`
      )
    );
    requestedComponents.forEach((component) => {
      console.log(chalk2.green(`   \u2022 ${component.name} (requested)`));
    });
    if (dependencies.length > 0) {
      console.log(chalk2.blue("\nWith internal dependencies:"));
      dependencies.forEach((component) => {
        console.log(chalk2.gray(`   \u2022 ${component.name}`));
      });
    }
    console.log("");
    spinner.start(`Preparing components...`);
    const allComponentFiles = [];
    for (const component of allComponents) {
      const files = await Promise.all(
        component.files.map(async (file) => {
          const content = await getComponentFile(file.path);
          const normalizedContent = normalizeComponentContent(
            content,
            componentAliasPrefix
          );
          return {
            ...file,
            content: normalizedContent,
            componentName: component.name
          };
        })
      );
      allComponentFiles.push(...files);
    }
    spinner.text = `Checking existing files...`;
    const existingFiles = [];
    for (const file of allComponentFiles) {
      const targetPath = resolveComponentPath(file.path, config);
      if (await fileExists(targetPath)) {
        existingFiles.push({ file, targetPath });
      }
    }
    if (existingFiles.length > 0) {
      spinner.stop();
      console.log(chalk2.yellow(`
The following files already exist:`));
      existingFiles.forEach(({ targetPath }) => {
        console.log(chalk2.gray(`   ${targetPath}`));
      });
      if (isDryRun) {
        console.log(chalk2.blue("\n[dry-run] Would overwrite the files above"));
        spinner.start(`[dry-run] Preparing file writes...`);
      } else {
        const { shouldOverwrite } = await inquirer.prompt([
          {
            type: "confirm",
            name: "shouldOverwrite",
            message: "Do you want to overwrite these files?",
            default: false
          }
        ]);
        if (!shouldOverwrite) {
          console.log(chalk2.red("Installation cancelled"));
          return;
        }
        spinner.start(`Installing component files...`);
      }
    } else {
      spinner.text = isDryRun ? `[dry-run] Preparing file writes...` : `Installing component files...`;
    }
    for (const file of allComponentFiles) {
      const targetPath = resolveComponentPath(file.path, config);
      if (isDryRun) {
      } else {
        await writeComponentFile(targetPath, file.content);
      }
    }
    const allDeps = {};
    for (const component of allComponents) {
      Object.assign(allDeps, component.dependencies);
    }
    const deps = Object.keys(allDeps);
    if (deps.length > 0) {
      spinner.text = `Checking dependencies...`;
      try {
        const installedDeps = await getInstalledDependencies();
        const depsToInstall = {};
        const skippedDeps = [];
        const incompatibleDeps = [];
        for (const [depName, requiredVersion] of Object.entries(allDeps)) {
          const installedVersion = installedDeps[depName];
          if (installedVersion) {
            try {
              const cleanInstalledVersion = installedVersion.replace(/^v/, "");
              const cleanRequiredVersion = requiredVersion.replace(
                /^[v^~]/,
                ""
              );
              if (depName === "react" || depName === "react-dom") {
                const installedMajor = semver.major(cleanInstalledVersion);
                const requiredMajor = semver.major(cleanRequiredVersion);
                if (installedMajor >= requiredMajor) {
                  skippedDeps.push(
                    `${depName}@${installedVersion} (newer version compatible with ${requiredVersion})`
                  );
                  continue;
                }
              }
              const satisfies2 = semver.satisfies(
                cleanInstalledVersion,
                requiredVersion
              );
              if (satisfies2) {
                skippedDeps.push(
                  `${depName}@${installedVersion} (satisfies ${requiredVersion})`
                );
              } else {
                const installedMajor = semver.major(cleanInstalledVersion);
                const requiredMajor = semver.major(cleanRequiredVersion);
                if (installedMajor > requiredMajor) {
                  skippedDeps.push(
                    `${depName}@${installedVersion} (newer major version, assuming compatibility)`
                  );
                } else {
                  incompatibleDeps.push(
                    `${depName}: installed ${installedVersion}, required ${requiredVersion}`
                  );
                  depsToInstall[depName] = requiredVersion;
                }
              }
            } catch (semverError) {
              const errorMessage = semverError instanceof Error ? semverError.message : "Unknown error";
              console.log(
                chalk2.yellow(
                  `[WARN] Could not compare versions for ${depName}: ${errorMessage}`
                )
              );
              depsToInstall[depName] = requiredVersion;
            }
          } else {
            depsToInstall[depName] = requiredVersion;
          }
        }
        if (Object.keys(depsToInstall).length > 0) {
          spinner.text = isDryRun ? `[dry-run] Checking missing dependencies...` : `Installing missing dependencies...`;
          if (!isDryRun) {
            await installDependencies(depsToInstall);
          }
        }
        if (skippedDeps.length > 0) {
          console.log(chalk2.green("\nDependencies already satisfied:"));
          skippedDeps.forEach((dep) => {
            console.log(chalk2.gray(`   ${dep}`));
          });
        }
        if (incompatibleDeps.length > 0) {
          console.log(
            chalk2.yellow(
              `
${isDryRun ? "[dry-run] Would update incompatible dependencies:" : "Incompatible dependencies updated:"}`
            )
          );
          incompatibleDeps.forEach((dep) => {
            console.log(chalk2.gray(`   ${dep}`));
          });
        }
        if (Object.keys(depsToInstall).length > 0) {
          console.log(
            chalk2.blue(
              `
${isDryRun ? "[dry-run] Would install dependencies:" : "Dependencies installed:"}`
            )
          );
          Object.entries(depsToInstall).forEach(([dep, version]) => {
            console.log(chalk2.gray(`   ${dep}@${version}`));
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.log(
          chalk2.yellow(
            `[WARN] Could not check existing dependencies: ${errorMessage}`
          )
        );
        console.log(
          chalk2.yellow(
            `${isDryRun ? "[dry-run] Would install all dependencies..." : "Installing all dependencies..."}`
          )
        );
        spinner.text = isDryRun ? `[dry-run] Checking dependencies...` : `Installing dependencies...`;
        if (!isDryRun) {
          await installDependencies(allDeps);
        }
        console.log(
          chalk2.blue(
            `
${isDryRun ? "[dry-run] Would install dependencies:" : "Dependencies installed:"}`
          )
        );
        Object.entries(allDeps).forEach(([dep, version]) => {
          console.log(chalk2.gray(`   ${dep}@${version}`));
        });
      }
    }
    const componentText = componentNames.length > 1 ? `${componentNames.length} components` : componentNames[0];
    spinner.succeed(
      `${isDryRun ? "[dry-run] " : ""}${componentText} ${isDryRun ? "would be added" : "added successfully!"}`
    );
    console.log(chalk2.green("\nComponents installed:"));
    allComponentFiles.forEach((file) => {
      const targetPath = resolveComponentPath(file.path, config);
      console.log(chalk2.gray(`   ${targetPath} (${file.componentName})`));
    });
    console.log(chalk2.blue(`
${isDryRun ? "[dry-run] Example imports:" : "Import and use:"}`));
    const normalizeAliasPath = (aliasPath) => {
      return aliasPath.replace(/^\.\/?/, "").replace(/^\/+/, "").replace(/^src\//, "").replace(/^app\//, "");
    };
    for (const componentName of componentNames) {
      const component = allComponents.find((c) => {
        const registryKey = c.files[0].path.split("/").pop()?.replace(".tsx", "") || "";
        return registryKey.toLowerCase() === componentName.toLowerCase() || c.name.toLowerCase() === componentName.toLowerCase();
      });
      if (component) {
        const firstFile = component.files[0];
        const componentPath = firstFile.path.replace("components/", "").replace(".tsx", "");
        const basePath = normalizeAliasPath(config.aliases.components);
        const aliasBase = basePath ? joinImportPath(componentAliasPrefix, basePath) : componentAliasPrefix;
        const importPath = joinImportPath(aliasBase, componentPath);
        console.log(
          chalk2.gray(
            `   import { ${component.exports.join(", ")} } from "${importPath}"; // ${component.name}`
          )
        );
      }
    }
    const componentsWithVariants = requestedComponents.filter(
      (c) => c.variants && c.variants.length > 0
    );
    if (componentsWithVariants.length > 0) {
      console.log(chalk2.blue("\nAvailable variants:"));
      componentsWithVariants.forEach((component) => {
        console.log(
          chalk2.gray(
            `   ${component.name}: ${component.variants.join(", ")}`
          )
        );
      });
    }
    const componentsWithSizes = requestedComponents.filter(
      (c) => c.sizes && c.sizes.length > 0
    );
    if (componentsWithSizes.length > 0) {
      console.log(chalk2.blue("\nAvailable sizes:"));
      componentsWithSizes.forEach((component) => {
        console.log(
          chalk2.gray(`   ${component.name}: ${component.sizes.join(", ")}`)
        );
      });
    }
  } catch (error) {
    const componentText = componentNames.length > 1 ? `components: ${componentNames.join(", ")}` : componentNames[0];
    spinner.fail(`Failed to add ${componentText}`);
    if (error instanceof Error) {
      console.log(chalk2.red(`${error.message}`));
    }
    throw error;
  }
}
async function init(options = {}) {
  const isDryRun = Boolean(options?.dryRun);
  const spinner = ora(`${isDryRun ? "[dry-run] " : ""}Initializing nocta-ui...`).start();
  const createdFiles = [];
  try {
    const existingConfig = await readConfig();
    if (existingConfig) {
      spinner.stop();
      console.log(chalk2.yellow("nocta.config.json already exists!"));
      console.log(chalk2.gray("Your project is already initialized."));
      return;
    }
    spinner.text = "Checking Tailwind CSS installation...";
    const tailwindCheck = await checkTailwindInstallation();
    if (!tailwindCheck.installed) {
      spinner.fail("Tailwind CSS is required but not found!");
      console.log(
        chalk2.red(
          "\nTailwind CSS is not installed or not found in node_modules"
        )
      );
      console.log(chalk2.yellow("Please install Tailwind CSS first:"));
      console.log(chalk2.gray("   npm install -D tailwindcss"));
      console.log(chalk2.gray("   # or"));
      console.log(chalk2.gray("   yarn add -D tailwindcss"));
      console.log(chalk2.gray("   # or"));
      console.log(chalk2.gray("   pnpm add -D tailwindcss"));
      console.log(
        chalk2.blue(
          "\nVisit https://tailwindcss.com/docs/installation for setup guide"
        )
      );
      return;
    }
    spinner.text = `Found Tailwind CSS ${tailwindCheck.version} \u2713`;
    spinner.text = "Detecting project framework...";
    const frameworkDetection = await detectFramework();
    if (frameworkDetection.framework === "unknown") {
      spinner.fail("Unsupported project structure detected!");
      console.log(chalk2.red("\nCould not detect a supported React framework"));
      console.log(chalk2.yellow("nocta-ui supports:"));
      console.log(chalk2.gray("   \u2022 Next.js (App Router or Pages Router)"));
      console.log(chalk2.gray("   \u2022 Vite + React"));
      console.log(chalk2.gray("   \u2022 React Router 7 (Framework Mode)"));
      console.log(chalk2.blue("\nDetection details:"));
      console.log(
        chalk2.gray(
          `   React dependency: ${frameworkDetection.details.hasReactDependency ? "\u2713" : "\u2717"}`
        )
      );
      console.log(
        chalk2.gray(
          `   Framework config: ${frameworkDetection.details.hasConfig ? "\u2713" : "\u2717"}`
        )
      );
      console.log(
        chalk2.gray(
          `   Config files found: ${frameworkDetection.details.configFiles.join(", ") || "none"}`
        )
      );
      if (!frameworkDetection.details.hasReactDependency) {
        console.log(chalk2.yellow("\nInstall React first:"));
        console.log(chalk2.gray("   npm install react react-dom"));
        console.log(
          chalk2.gray("   npm install -D @types/react @types/react-dom")
        );
      } else {
        console.log(chalk2.yellow("\nSet up a supported framework:"));
        console.log(chalk2.blue("   Next.js:"));
        console.log(chalk2.gray("     npx create-next-app@latest"));
        console.log(chalk2.blue("   Vite + React:"));
        console.log(
          chalk2.gray("     npm create vite@latest . -- --template react-ts")
        );
        console.log(chalk2.blue("   React Router 7:"));
        console.log(chalk2.gray("     npx create-react-router@latest"));
      }
      return;
    }
    let frameworkInfo = "";
    if (frameworkDetection.framework === "nextjs") {
      const routerType = frameworkDetection.details.appStructure;
      frameworkInfo = `Next.js ${frameworkDetection.version || ""} (${routerType === "app-router" ? "App Router" : routerType === "pages-router" ? "Pages Router" : "Unknown Router"})`;
    } else if (frameworkDetection.framework === "vite-react") {
      frameworkInfo = `Vite ${frameworkDetection.version || ""} + React`;
    } else if (frameworkDetection.framework === "react-router") {
      frameworkInfo = `React Router ${frameworkDetection.version || ""} (Framework Mode)`;
    }
    spinner.text = `Found ${frameworkInfo} \u2713`;
    spinner.text = "Validating project requirements...";
    const { requirements } = await getRegistry();
    const requirementIssues = await checkProjectRequirements(requirements);
    if (requirementIssues.length > 0) {
      spinner.fail("Project requirements not satisfied!");
      console.log(chalk2.red("\nPlease update the following dependencies:"));
      for (const issue of requirementIssues) {
        console.log(
          chalk2.yellow(`   ${issue.name}: requires ${issue.required}`)
        );
        const detailLines = [];
        detailLines.push(
          issue.installed ? chalk2.gray(`installed: ${issue.installed}`) : chalk2.gray("installed: not found")
        );
        if (issue.declared) {
          detailLines.push(chalk2.gray(`declared: ${issue.declared}`));
        }
        if (issue.reason === "outdated") {
          detailLines.push(chalk2.gray("update to a compatible version"));
        } else if (issue.reason === "unknown") {
          detailLines.push(chalk2.gray("unable to determine installed version"));
        }
        for (const line of detailLines) {
          console.log(`      ${line}`);
        }
      }
      return;
    }
    const versionStr = tailwindCheck.version || "";
    const majorMatch = versionStr.match(/[\^~]?(\d+)(?:\.|\b)/);
    const major = majorMatch ? parseInt(majorMatch[1], 10) : /latest/i.test(versionStr) ? 4 : 0;
    const isTailwindV4 = major >= 4;
    if (!isTailwindV4) {
      spinner.fail("Tailwind CSS v4 is required");
      console.log(
        chalk2.red(
          "\nDetected Tailwind version that is not v4: " + (tailwindCheck.version || "unknown")
        )
      );
      console.log(chalk2.yellow("Please upgrade to Tailwind CSS v4:"));
      console.log(chalk2.gray("   npm install -D tailwindcss@latest"));
      console.log(chalk2.gray("   # or"));
      console.log(chalk2.gray("   yarn add -D tailwindcss@latest"));
      console.log(chalk2.gray("   # or"));
      console.log(chalk2.gray("   pnpm add -D tailwindcss@latest"));
      return;
    }
    spinner.stop();
    spinner.start(`${isDryRun ? "[dry-run] " : ""}Creating configuration...`);
    let config;
    const aliasPrefix = frameworkDetection.framework === "react-router" ? "~" : "@";
    if (frameworkDetection.framework === "nextjs") {
      const isAppRouter = frameworkDetection.details.appStructure === "app-router";
      config = {
        style: "default",
        tailwind: {
          css: isAppRouter ? "app/globals.css" : "styles/globals.css"
        },
        aliases: {
          components: "components/ui",
          utils: "lib/utils"
        }
      };
    } else if (frameworkDetection.framework === "vite-react") {
      config = {
        style: "default",
        tailwind: {
          css: "src/App.css"
        },
        aliases: {
          components: "src/components/ui",
          utils: "src/lib/utils"
        }
      };
    } else if (frameworkDetection.framework === "react-router") {
      config = {
        style: "default",
        tailwind: {
          css: "app/app.css"
        },
        aliases: {
          components: "app/components/ui",
          utils: "app/lib/utils"
        }
      };
    } else {
      throw new Error("Unsupported framework configuration");
    }
    config.aliasPrefixes = {
      components: aliasPrefix,
      utils: aliasPrefix
    };
    if (isDryRun) {
      console.log(chalk2.blue("\n[dry-run] Would create configuration:"));
      console.log(chalk2.gray("   nocta.config.json"));
    } else {
      await writeConfig(config);
      createdFiles.push("nocta.config.json");
    }
    spinner.text = isDryRun ? "[dry-run] Checking required dependencies..." : "Installing required dependencies...";
    const requiredDependencies = {
      clsx: "^2.1.1",
      "tailwind-merge": "^3.3.1",
      "class-variance-authority": "^0.7.1",
      "@ariakit/react": "^0.4.18",
      "@radix-ui/react-icons": "^1.3.2"
    };
    try {
      if (isDryRun) {
        console.log(chalk2.blue("\n[dry-run] Would install dependencies:"));
        Object.entries(requiredDependencies).forEach(
          ([dep, ver]) => console.log(chalk2.gray(`   ${dep}@${ver}`))
        );
      } else {
        await installDependencies(requiredDependencies);
      }
    } catch (error) {
      spinner.warn(
        "Dependencies installation failed, but you can install them manually"
      );
      console.log(chalk2.yellow("Run: npm install clsx tailwind-merge"));
    }
    spinner.text = "Creating utility functions...";
    const utilsPath = `${config.aliases.utils}.ts`;
    const utilsExists = await fileExists(utilsPath);
    let utilsCreated = false;
    if (utilsExists) {
      spinner.stop();
      console.log(
        chalk2.yellow(`${utilsPath} already exists - skipping creation`)
      );
      spinner.start();
    } else {
      if (isDryRun) {
        console.log(chalk2.blue("\n[dry-run] Would create utility functions:"));
        console.log(chalk2.gray(`   ${utilsPath}`));
        utilsCreated = true;
      } else {
        const utilsContent = await getRegistryAsset("lib/utils.ts");
        await writeComponentFile(utilsPath, utilsContent);
        createdFiles.push(utilsPath);
        utilsCreated = true;
      }
    }
    spinner.text = "Creating base icons component...";
    const iconsPath = resolveComponentPath("components/icons.ts", config);
    const iconsExist = await fileExists(iconsPath);
    let iconsCreated = false;
    if (iconsExist) {
      spinner.stop();
      console.log(
        chalk2.yellow(`${iconsPath} already exists - skipping creation`)
      );
      spinner.start();
    } else {
      if (isDryRun) {
        console.log(chalk2.blue("\n[dry-run] Would create icons component:"));
        console.log(chalk2.gray(`   ${iconsPath}`));
        iconsCreated = true;
      } else {
        const iconsContent = await getRegistryAsset("icons/icons.ts");
        await writeComponentFile(iconsPath, iconsContent);
        createdFiles.push(iconsPath);
        iconsCreated = true;
      }
    }
    spinner.text = "Adding semantic color variables...";
    let tokensAdded = false;
    let tokensLocation = "";
    try {
      const cssPath = config.tailwind.css;
      if (isDryRun) {
        const fullCss = fs4.existsSync(cssPath) ? await fs4.readFile(cssPath, "utf8") : "";
        const hasTokens = fullCss.includes("NOCTA CSS THEME VARIABLES");
        if (!hasTokens) {
          tokensAdded = true;
          tokensLocation = cssPath;
        }
      } else {
        const added = await addDesignTokensToCss(cssPath);
        if (added) {
          tokensAdded = true;
          tokensLocation = cssPath;
        }
      }
    } catch (error) {
      spinner.warn(
        "Design tokens installation failed, but you can add them manually"
      );
      console.log(
        chalk2.yellow("See documentation for manual token installation")
      );
    }
    spinner.succeed(
      `${isDryRun ? "[dry-run] " : ""}nocta-ui ${isDryRun ? "would be initialized" : "initialized successfully!"}`
    );
    console.log(chalk2.green("\nConfiguration created:"));
    console.log(chalk2.gray(`   nocta.config.json (${frameworkInfo})`));
    console.log(
      chalk2.blue(
        `
${isDryRun ? "[dry-run] Would install dependencies:" : "Dependencies installed:"}`
      )
    );
    console.log(chalk2.gray(`   clsx@${requiredDependencies.clsx}`));
    console.log(
      chalk2.gray(`   tailwind-merge@${requiredDependencies["tailwind-merge"]}`)
    );
    console.log(
      chalk2.gray(
        `   class-variance-authority@${requiredDependencies["class-variance-authority"]}`
      )
    );
    if (utilsCreated) {
      console.log(chalk2.green("\nUtility functions created:"));
      console.log(chalk2.gray(`   ${utilsPath}`));
      console.log(chalk2.gray(`   \u2022 cn() function for className merging`));
    }
    if (iconsCreated) {
      console.log(chalk2.green("\nIcons component created:"));
      console.log(chalk2.gray(`   ${iconsPath}`));
      console.log(chalk2.gray("   \u2022 Base Radix Icons mapping"));
    }
    if (tokensAdded) {
      console.log(
        chalk2.green(
          `
${isDryRun ? "[dry-run] Would add color variables:" : "Color variables added:"}`
        )
      );
      console.log(chalk2.gray(`   ${tokensLocation}`));
      console.log(
        chalk2.gray(
          `   \u2022 Semantic tokens (background, foreground, primary, border, etc.)`
        )
      );
    } else if (!tokensAdded && tokensLocation === "") {
      console.log(
        chalk2.yellow(
          `
${isDryRun ? "[dry-run] Design tokens skipped (likely already present)" : "Design tokens skipped (already exist or error occurred)"}`
        )
      );
    }
    if (isTailwindV4) {
      console.log(chalk2.blue("\nTailwind v4 detected!"));
      console.log(
        chalk2.gray(
          '   Make sure your CSS file includes @import "tailwindcss";'
        )
      );
    }
    console.log(
      chalk2.blue(
        `
${isDryRun ? "[dry-run] You could then add components:" : "You can now add components:"}`
      )
    );
    console.log(chalk2.gray("   npx nocta-ui add button"));
  } catch (error) {
    spinner.fail("Failed to initialize nocta-ui");
    try {
      await rollbackInitChanges(createdFiles);
      console.log(chalk2.yellow("Rolled back partial changes"));
    } catch (rollbackError) {
      console.log(
        chalk2.red("Could not rollback some changes - please check manually")
      );
    }
    throw error;
  }
}
async function list() {
  const spinner = ora("Fetching components...").start();
  try {
    const [components, categories] = await Promise.all([
      listComponents(),
      getCategories()
    ]);
    spinner.stop();
    console.log(chalk2.blue.bold("\nAvailable nocta-ui components:\n"));
    Object.entries(categories).forEach(([categoryKey, category]) => {
      console.log(chalk2.yellow.bold(`${category.name}:`));
      console.log(chalk2.gray(`  ${category.description}
`));
      const categoryComponents = components.filter(
        (comp) => comp.category === categoryKey
      );
      categoryComponents.forEach((component) => {
        console.log(chalk2.green(`  ${component.name.toLowerCase()}`));
        console.log(chalk2.gray(`    ${component.description}`));
        if (component.variants && component.variants.length > 0) {
          console.log(
            chalk2.blue(`  Variants: ${component.variants.join(", ")}`)
          );
        }
        if (component.sizes && component.sizes.length > 0) {
          console.log(chalk2.blue(`  Sizes: ${component.sizes.join(", ")}`));
        }
        console.log();
      });
    });
    console.log(chalk2.blue("\nAdd a component:"));
    console.log(chalk2.gray("  npx nocta-ui add <component-name>"));
    console.log(chalk2.blue("\nExamples:"));
    console.log(chalk2.gray("  npx nocta-ui add button"));
    console.log(chalk2.gray("  npx nocta-ui add card"));
  } catch (error) {
    spinner.fail("Failed to fetch components");
    throw error;
  }
}

// src/cli.ts
var packageJsonUrl = new URL("../package.json", import.meta.url);
var packageJson = JSON.parse(fs9.readFileSync(packageJsonUrl, "utf8"));
var program = new Command();
program.name("nocta-ui").description("CLI for Nocta UI Components Library").version(packageJson.version);
program.command("init").description("Initialize your project with components config").option("--dry-run", "Preview actions without writing or installing").action(async (options) => {
  try {
    await init({ dryRun: Boolean(options?.dryRun) });
  } catch (error) {
    console.error(chalk2.red("Error:", error));
    process.exit(1);
  }
});
program.command("add").description("Add components to your project").argument("<components...>", "component names").option("--dry-run", "Preview actions without writing or installing").action(async (componentNames, options) => {
  try {
    await add(componentNames, { dryRun: Boolean(options?.dryRun) });
  } catch (error) {
    console.error(chalk2.red("Error:", error));
    process.exit(1);
  }
});
program.command("list").description("List all available components").action(async () => {
  try {
    await list();
  } catch (error) {
    console.error(chalk2.red("Error:", error));
    process.exit(1);
  }
});
program.on("command:*", () => {
  console.error(chalk2.red("Invalid command: %s"), program.args.join(" "));
  console.log(chalk2.yellow("See --help for a list of available commands."));
  process.exit(1);
});
program.parse();
//# sourceMappingURL=cli.js.map
//# sourceMappingURL=cli.js.map