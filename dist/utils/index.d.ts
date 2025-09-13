export { readConfig, writeConfig } from './config';
export { fileExists, writeComponentFile } from './fs';
export { resolveComponentPath } from './paths';
export { getInstalledDependencies, installDependencies } from './deps';
export { addDesignTokensToCss, checkTailwindInstallation } from './tailwind';
export { detectFramework, isTypeScriptProject } from './framework';
export type { FrameworkDetection } from './framework';
export { rollbackInitChanges } from './rollback';
export { getRegistry, getComponent, getComponentFile, listComponents, getComponentsByCategory, getCategories, getComponentWithDependencies } from './registry';
