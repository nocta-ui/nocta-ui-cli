import chalk from 'chalk';
import ora from 'ora';
import { writeConfig, readConfig, installDependencies, writeComponentFile, fileExists } from '../utils/files';
import { Config } from '../types';
import fs from 'fs-extra';
import path from 'path';

export async function init(): Promise<void> {
  const spinner = ora('Initializing nocta-ui...').start();

  try {
    const existingConfig = await readConfig();
    if (existingConfig) {
      spinner.stop();
      console.log(chalk.yellow('⚠️  components.json already exists!'));
      console.log(chalk.gray('Your project is already initialized.'));
      return;
    }

    const isNextJs = await fs.pathExists('next.config.js') || await fs.pathExists('next.config.mjs');
    const isVite = await fs.pathExists('vite.config.js') || await fs.pathExists('vite.config.ts');

    let isTailwindV4 = false;
    try {
      const packageJson = await fs.readJson('package.json');
      const tailwindVersion = packageJson.dependencies?.tailwindcss || packageJson.devDependencies?.tailwindcss;
      if (tailwindVersion && (tailwindVersion.includes('^4') || tailwindVersion.includes('4.'))) {
        isTailwindV4 = true;
      }
    } catch {
    }

    let config: Config;

    if (isNextJs) {
      config = {
        style: "default",
        tsx: true,
        tailwind: {
          config: isTailwindV4 ? "" : "tailwind.config.js",
          css: "app/globals.css"
        },
        aliases: {
          components: "components",
          utils: "lib/utils"
        }
      };
    } else if (isVite) {
      config = {
        style: "default",
        tsx: true,
        tailwind: {
          config: isTailwindV4 ? "" : "tailwind.config.js",
          css: "src/index.css"
        },
        aliases: {
          components: "src/components",
          utils: "src/lib/utils"
        }
      };
    } else {
      config = {
        style: "default",
        tsx: true,
        tailwind: {
          config: isTailwindV4 ? "" : "tailwind.config.js",
          css: "src/styles/globals.css"
        },
        aliases: {
          components: "src/components",
          utils: "src/lib/utils"
        }
      };
    }

    await writeConfig(config);

    // Install required dependencies
    spinner.text = 'Installing required dependencies...';
    const requiredDependencies = {
      'clsx': '^2.1.1',
      'tailwind-merge': '^3.3.1'
    };
    
    try {
      await installDependencies(requiredDependencies);
    } catch (error) {
      spinner.warn('Dependencies installation failed, but you can install them manually');
      console.log(chalk.yellow('💡 Run: npm install clsx tailwind-merge'));
    }

    // Create utils file
    spinner.text = 'Creating utility functions...';
    const utilsContent = `import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`;

    const utilsPath = `${config.aliases.utils}.ts`;
    const utilsExists = await fileExists(utilsPath);
    let utilsCreated = false;
    
    if (utilsExists) {
      spinner.stop();
      console.log(chalk.yellow(`⚠️  ${utilsPath} already exists - skipping creation`));
      spinner.start();
    } else {
      await writeComponentFile(utilsPath, utilsContent);
      utilsCreated = true;
    }

    spinner.succeed('nocta-ui initialized successfully!');
    
    console.log(chalk.green('\n✅ Configuration created:'));
    console.log(chalk.gray(`   components.json`));
    
    console.log(chalk.blue('\n📦 Dependencies installed:'));
    console.log(chalk.gray(`   clsx@${requiredDependencies.clsx}`));
    console.log(chalk.gray(`   tailwind-merge@${requiredDependencies['tailwind-merge']}`));
    
    if (utilsCreated) {
      console.log(chalk.green('\n🔧 Utility functions created:'));
      console.log(chalk.gray(`   ${utilsPath}`));
      console.log(chalk.gray(`   • cn() function for className merging`));
    }
    
    if (isTailwindV4) {
      console.log(chalk.blue('\n🎨 Tailwind v4 detected!'));
      console.log(chalk.gray('   Make sure your CSS file includes @import "tailwindcss";'));
    }
    
    console.log(chalk.blue('\n🚀 You can now add components:'));
    console.log(chalk.gray('   npx nocta-ui add button'));

  } catch (error) {
    spinner.fail('Failed to initialize nocta-ui');
    throw error;
  }
}