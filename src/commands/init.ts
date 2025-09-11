import chalk from 'chalk';
import ora from 'ora';
import { writeConfig, readConfig, installDependencies, writeComponentFile, fileExists, addDesignTokensToCss, addDesignTokensToTailwindConfig, checkTailwindInstallation, rollbackInitChanges, detectFramework, getTailwindConfigPath, addBaseCssVariables } from '../utils/files';
import { Config } from '../types';
import fs from 'fs-extra';
import path from 'path';

export async function init(): Promise<void> {
  const spinner = ora('Initializing nocta-ui...').start();

  try {
    const existingConfig = await readConfig();
    if (existingConfig) {
      spinner.stop();
      console.log(chalk.yellow('nocta.config.json already exists!'));
      console.log(chalk.gray('Your project is already initialized.'));
      return;
    }

    // Check if Tailwind CSS is installed
    spinner.text = 'Checking Tailwind CSS installation...';
    const tailwindCheck = await checkTailwindInstallation();
    
    if (!tailwindCheck.installed) {
      spinner.fail('Tailwind CSS is required but not found!');
      console.log(chalk.red('\nTailwind CSS is not installed or not found in node_modules'));
      console.log(chalk.yellow('Please install Tailwind CSS first:'));
      console.log(chalk.gray('   npm install -D tailwindcss'));
      console.log(chalk.gray('   # or'));
      console.log(chalk.gray('   yarn add -D tailwindcss'));
      console.log(chalk.gray('   # or'));
      console.log(chalk.gray('   pnpm add -D tailwindcss'));
      console.log(chalk.blue('\nVisit https://tailwindcss.com/docs/installation for setup guide'));
      return;
    }

    spinner.text = `Found Tailwind CSS ${tailwindCheck.version} ✓`;

    // Detect framework with detailed validation
    spinner.text = 'Detecting project framework...';
    const frameworkDetection = await detectFramework();
    
    if (frameworkDetection.framework === 'unknown') {
      spinner.fail('Unsupported project structure detected!');
      console.log(chalk.red('\nCould not detect a supported React framework'));
      console.log(chalk.yellow('nocta-ui supports:'));
      console.log(chalk.gray('   • Next.js (App Router or Pages Router)'));
      console.log(chalk.gray('   • Vite + React'));
      console.log(chalk.gray('   • React Router 7 (Framework Mode)'));
      console.log(chalk.blue('\nDetection details:'));
      console.log(chalk.gray(`   React dependency: ${frameworkDetection.details.hasReactDependency ? '✓' : '✗'}`));
      console.log(chalk.gray(`   Framework config: ${frameworkDetection.details.hasConfig ? '✓' : '✗'}`));
      console.log(chalk.gray(`   Config files found: ${frameworkDetection.details.configFiles.join(', ') || 'none'}`));
      
      if (!frameworkDetection.details.hasReactDependency) {
        console.log(chalk.yellow('\nInstall React first:'));
        console.log(chalk.gray('   npm install react react-dom'));
        console.log(chalk.gray('   npm install -D @types/react @types/react-dom'));
      } else {
        console.log(chalk.yellow('\nSet up a supported framework:'));
        console.log(chalk.blue('   Next.js:'));
        console.log(chalk.gray('     npx create-next-app@latest'));
        console.log(chalk.blue('   Vite + React:'));
        console.log(chalk.gray('     npm create vite@latest . -- --template react-ts'));
        console.log(chalk.blue('   React Router 7:'));
        console.log(chalk.gray('     npx create-react-router@latest'));
      }
      return;
    }

    // Show detected framework info
    let frameworkInfo = '';
    if (frameworkDetection.framework === 'nextjs') {
      const routerType = frameworkDetection.details.appStructure;
      frameworkInfo = `Next.js ${frameworkDetection.version || ''} (${routerType === 'app-router' ? 'App Router' : routerType === 'pages-router' ? 'Pages Router' : 'Unknown Router'})`;
    } else if (frameworkDetection.framework === 'vite-react') {
      frameworkInfo = `Vite ${frameworkDetection.version || ''} + React`;
    } else if (frameworkDetection.framework === 'react-router') {
      frameworkInfo = `React Router ${frameworkDetection.version || ''} (Framework Mode)`;
    }
    
    spinner.text = `Found ${frameworkInfo} ✓`;

    // Determine Tailwind version from already checked installation
    const isTailwindV4 = tailwindCheck.version ? (tailwindCheck.version.includes('^4') || tailwindCheck.version.startsWith('4.')) : false;

    // Get the appropriate Tailwind config path based on TypeScript project detection
    const tailwindConfigPath = await getTailwindConfigPath();

    // Create configuration without theme selection (single default palette)
    spinner.stop();
    spinner.start('Creating configuration...');

    let config: Config;

    if (frameworkDetection.framework === 'nextjs') {
      const isAppRouter = frameworkDetection.details.appStructure === 'app-router';
      config = {
        style: "default",
        tsx: true,
        tailwind: {
          config: isTailwindV4 ? "" : tailwindConfigPath,
          css: isAppRouter ? "app/globals.css" : "styles/globals.css"
        },
        aliases: {
          components: "components",
          utils: "lib/utils"
        }
      };
    } else if (frameworkDetection.framework === 'vite-react') {
      config = {
        style: "default",
        tsx: true,
        tailwind: {
          config: isTailwindV4 ? "" : tailwindConfigPath,
          css: "src/App.css"
        },
        aliases: {
          components: "src/components",
          utils: "src/lib/utils"
        }
      };
    } else if (frameworkDetection.framework === 'react-router') {
      config = {
        style: "default",
        tsx: true,
        tailwind: {
          config: isTailwindV4 ? "" : tailwindConfigPath,
          css: "app/app.css"
        },
        aliases: {
          components: "app/components",
          utils: "app/lib/utils"
        }
      };
    } else {
      // This shouldn't happen due to earlier validation, but just in case
      throw new Error('Unsupported framework configuration');
    }

    await writeConfig(config);

    // Install required dependencies
    spinner.text = 'Installing required dependencies...';
    const requiredDependencies = {
      'clsx': '^2.1.1',
      'tailwind-merge': '^3.3.1',
      'class-variance-authority': '^0.7.1'
    };
    
    try {
      await installDependencies(requiredDependencies);
    } catch (error) {
      spinner.warn('Dependencies installation failed, but you can install them manually');
      console.log(chalk.yellow('Run: npm install clsx tailwind-merge'));
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
      console.log(chalk.yellow(`${utilsPath} already exists - skipping creation`));
      spinner.start();
    } else {
      await writeComponentFile(utilsPath, utilsContent);
      utilsCreated = true;
    }

    // Add design tokens
    spinner.text = 'Adding semantic color variables...';
    let tokensAdded = false;
    let tokensLocation = '';
    
    try {
      if (isTailwindV4) {
        // For Tailwind v4, add tokens to CSS file using @theme
        const cssPath = config.tailwind.css;
        const added = await addDesignTokensToCss(cssPath);
        if (added) {
          tokensAdded = true;
          tokensLocation = cssPath;
        }
      } else {
        // For Tailwind v3, add base CSS variables and map them in tailwind config
        const cssPath = config.tailwind.css;
        try {
          await addBaseCssVariables(cssPath);
        } catch {}
        const configPath = config.tailwind.config;
        if (configPath) {
          const added = await addDesignTokensToTailwindConfig(configPath);
          if (added) {
            tokensAdded = true;
            tokensLocation = configPath;
          }
        } else {
          // This shouldn't happen for v3, but create config if needed
          const added = await addDesignTokensToTailwindConfig(tailwindConfigPath);
          if (added) {
            tokensAdded = true;
            tokensLocation = tailwindConfigPath;
          }
        }
      }
    } catch (error) {
      spinner.warn('Design tokens installation failed, but you can add them manually');
      console.log(chalk.yellow('See documentation for manual token installation'));
    }

    spinner.succeed('nocta-ui initialized successfully!');
    
    console.log(chalk.green('\nConfiguration created:'));
    console.log(chalk.gray(`   nocta.config.json (${frameworkInfo})`));
    
    console.log(chalk.blue('\nDependencies installed:'));
    console.log(chalk.gray(`   clsx@${requiredDependencies.clsx}`));
    console.log(chalk.gray(`   tailwind-merge@${requiredDependencies['tailwind-merge']}`));
    console.log(chalk.gray(`   class-variance-authority@${requiredDependencies['class-variance-authority']}`));
    
    if (utilsCreated) {
      console.log(chalk.green('\nUtility functions created:'));
      console.log(chalk.gray(`   ${utilsPath}`));
      console.log(chalk.gray(`   • cn() function for className merging`));
    }
    
    if (tokensAdded) {
      console.log(chalk.green('\nColor variables added:'));
      console.log(chalk.gray(`   ${tokensLocation}`));
      console.log(chalk.gray(`   • Semantic tokens (background, foreground, primary, border, etc.)`));
    } else if (!tokensAdded && tokensLocation === '') {
      console.log(chalk.yellow('\nDesign tokens skipped (already exist or error occurred)'));
    }
    
    if (isTailwindV4) {
      console.log(chalk.blue('\nTailwind v4 detected!'));
      console.log(chalk.gray('   Make sure your CSS file includes @import "tailwindcss";'));
    }
    
    console.log(chalk.blue('\nYou can now add components:'));
    console.log(chalk.gray('   npx nocta-ui add button'));

  } catch (error) {
    spinner.fail('Failed to initialize nocta-ui');
    
    // Rollback any changes that might have been made
    try {
      await rollbackInitChanges();
      console.log(chalk.yellow('Rolled back partial changes'));
    } catch (rollbackError) {
      console.log(chalk.red('Could not rollback some changes - please check manually'));
    }
    
    throw error;
  }
}
