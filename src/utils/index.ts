// Configuration utilities
export { readConfig, writeConfig } from './config';

// File system utilities
export { fileExists, writeComponentFile } from './fs';

// Path utilities
export { resolveComponentPath } from './paths';

// Dependency management utilities
export { getInstalledDependencies, installDependencies } from './deps';

// Tailwind utilities
export { addDesignTokensToCss, checkTailwindInstallation } from './tailwind';

// Framework detection utilities
export { detectFramework, isTypeScriptProject } from './framework';
export type { FrameworkDetection } from './framework';

// Rollback utilities
export { rollbackInitChanges } from './rollback';

// Registry utilities
export { 
  getRegistry, 
  getComponent, 
  getComponentFile, 
  listComponents, 
  getComponentsByCategory, 
  getCategories, 
  getComponentWithDependencies 
} from './registry';
