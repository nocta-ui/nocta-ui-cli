import fs from 'fs-extra';
import path from 'path';

export async function rollbackInitChanges(): Promise<void> {
  const filesToCheck = [
    'nocta.config.json',
    'tailwind.config.js',
    'tailwind.config.ts',
    'lib/utils.ts',
    'src/lib/utils.ts',
  ];

  for (const file of filesToCheck) {
    const fullPath = path.join(process.cwd(), file);
    if (await fs.pathExists(fullPath)) {
      try {
        await fs.remove(fullPath);
      } catch {
        // ignore
      }
    }
  }
}

