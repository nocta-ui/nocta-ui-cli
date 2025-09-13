export { readConfig, writeConfig } from "./config";
export { getInstalledDependencies, installDependencies } from "./deps";
export type { FrameworkDetection } from "./framework";
export { detectFramework, isTypeScriptProject } from "./framework";
export { fileExists, writeComponentFile } from "./fs";
export { resolveComponentPath } from "./paths";
export { getCategories, getComponent, getComponentFile, getComponentsByCategory, getComponentWithDependencies, getRegistry, listComponents, } from "./registry";
export { rollbackInitChanges } from "./rollback";
export { addDesignTokensToCss, checkTailwindInstallation } from "./tailwind";
