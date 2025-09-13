import fs from 'fs-extra';
import path from 'path';
import type { Config } from '../types';

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

