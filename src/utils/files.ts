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

export async function writeComponentFile(filePath: string, content: string): Promise<void> {
  const fullPath = path.join(process.cwd(), filePath);
  await fs.ensureDir(path.dirname(fullPath));
  await fs.writeFile(fullPath, content, 'utf8');
}

export function resolveComponentPath(componentFilePath: string, config: Config): string {
  // Usuń całą ścieżkę do pliku i zostaw tylko nazwę pliku
  const fileName = path.basename(componentFilePath);
  
  // Wyciągnij folder komponentu z ścieżki (np. z "app/components/ui/button/button.tsx" -> "button")
  const componentFolder = path.basename(path.dirname(componentFilePath));
  
  // Utwórz docelową ścieżkę: components/ui/button.tsx
  return path.join(config.aliases.components, 'ui', fileName);
}

export async function installDependencies(dependencies: Record<string, string>): Promise<void> {
  const deps = Object.keys(dependencies);
  if (deps.length === 0) return;

  const { execSync } = require('child_process');
  
  // Sprawdź który package manager jest używany
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