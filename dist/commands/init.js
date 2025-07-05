"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.init = init;
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const inquirer_1 = __importDefault(require("inquirer"));
const files_1 = require("../utils/files");
const types_1 = require("../types");
async function init() {
    const spinner = (0, ora_1.default)('Initializing nocta-ui...').start();
    try {
        const existingConfig = await (0, files_1.readConfig)();
        if (existingConfig) {
            spinner.stop();
            console.log(chalk_1.default.yellow('nocta.config.json already exists!'));
            console.log(chalk_1.default.gray('Your project is already initialized.'));
            return;
        }
        // Check if Tailwind CSS is installed
        spinner.text = 'Checking Tailwind CSS installation...';
        const tailwindCheck = await (0, files_1.checkTailwindInstallation)();
        if (!tailwindCheck.installed) {
            spinner.fail('Tailwind CSS is required but not found!');
            console.log(chalk_1.default.red('\nTailwind CSS is not installed or not found in node_modules'));
            console.log(chalk_1.default.yellow('Please install Tailwind CSS first:'));
            console.log(chalk_1.default.gray('   npm install -D tailwindcss'));
            console.log(chalk_1.default.gray('   # or'));
            console.log(chalk_1.default.gray('   yarn add -D tailwindcss'));
            console.log(chalk_1.default.gray('   # or'));
            console.log(chalk_1.default.gray('   pnpm add -D tailwindcss'));
            console.log(chalk_1.default.blue('\nVisit https://tailwindcss.com/docs/installation for setup guide'));
            return;
        }
        spinner.text = `Found Tailwind CSS ${tailwindCheck.version} ✓`;
        // Detect framework with detailed validation
        spinner.text = 'Detecting project framework...';
        const frameworkDetection = await (0, files_1.detectFramework)();
        if (frameworkDetection.framework === 'unknown') {
            spinner.fail('Unsupported project structure detected!');
            console.log(chalk_1.default.red('\nCould not detect a supported React framework'));
            console.log(chalk_1.default.yellow('nocta-ui supports:'));
            console.log(chalk_1.default.gray('   • Next.js (App Router or Pages Router)'));
            console.log(chalk_1.default.gray('   • Vite + React'));
            console.log(chalk_1.default.gray('   • React Router 7 (Framework Mode)'));
            console.log(chalk_1.default.blue('\nDetection details:'));
            console.log(chalk_1.default.gray(`   React dependency: ${frameworkDetection.details.hasReactDependency ? '✓' : '✗'}`));
            console.log(chalk_1.default.gray(`   Framework config: ${frameworkDetection.details.hasConfig ? '✓' : '✗'}`));
            console.log(chalk_1.default.gray(`   Config files found: ${frameworkDetection.details.configFiles.join(', ') || 'none'}`));
            if (!frameworkDetection.details.hasReactDependency) {
                console.log(chalk_1.default.yellow('\nInstall React first:'));
                console.log(chalk_1.default.gray('   npm install react react-dom'));
                console.log(chalk_1.default.gray('   npm install -D @types/react @types/react-dom'));
            }
            else {
                console.log(chalk_1.default.yellow('\nSet up a supported framework:'));
                console.log(chalk_1.default.blue('   Next.js:'));
                console.log(chalk_1.default.gray('     npx create-next-app@latest'));
                console.log(chalk_1.default.blue('   Vite + React:'));
                console.log(chalk_1.default.gray('     npm create vite@latest . -- --template react-ts'));
                console.log(chalk_1.default.blue('   React Router 7:'));
                console.log(chalk_1.default.gray('     npx create-react-router@latest'));
            }
            return;
        }
        // Show detected framework info
        let frameworkInfo = '';
        if (frameworkDetection.framework === 'nextjs') {
            const routerType = frameworkDetection.details.appStructure;
            frameworkInfo = `Next.js ${frameworkDetection.version || ''} (${routerType === 'app-router' ? 'App Router' : routerType === 'pages-router' ? 'Pages Router' : 'Unknown Router'})`;
        }
        else if (frameworkDetection.framework === 'vite-react') {
            frameworkInfo = `Vite ${frameworkDetection.version || ''} + React`;
        }
        else if (frameworkDetection.framework === 'react-router') {
            frameworkInfo = `React Router ${frameworkDetection.version || ''} (Framework Mode)`;
        }
        spinner.text = `Found ${frameworkInfo} ✓`;
        // Determine Tailwind version from already checked installation
        const isTailwindV4 = tailwindCheck.version ? (tailwindCheck.version.includes('^4') || tailwindCheck.version.startsWith('4.')) : false;
        // Get the appropriate Tailwind config path based on TypeScript project detection
        const tailwindConfigPath = await (0, files_1.getTailwindConfigPath)();
        // Theme selection
        spinner.stop();
        console.log(chalk_1.default.blue.bold('\nSelect a color theme:'));
        types_1.AVAILABLE_THEMES.forEach((theme, index) => {
            const isDefault = theme.name === 'charcoal' ? chalk_1.default.gray(' (default)') : '';
            console.log(`  ${index + 1}. ${chalk_1.default.green(theme.displayName)} - ${chalk_1.default.gray(theme.description)}${isDefault}`);
        });
        const { selectedTheme } = await inquirer_1.default.prompt([
            {
                type: 'list',
                name: 'selectedTheme',
                message: 'Choose your theme:',
                choices: types_1.AVAILABLE_THEMES.map(theme => ({
                    name: `${theme.displayName} - ${theme.description}`,
                    value: theme.name
                })),
                default: 'charcoal'
            }
        ]);
        console.log(chalk_1.default.green(`Selected theme: ${types_1.AVAILABLE_THEMES.find(t => t.name === selectedTheme)?.displayName}\n`));
        spinner.start('Creating configuration...');
        let config;
        if (frameworkDetection.framework === 'nextjs') {
            const isAppRouter = frameworkDetection.details.appStructure === 'app-router';
            config = {
                style: "default",
                tsx: true,
                theme: selectedTheme,
                tailwind: {
                    config: isTailwindV4 ? "" : tailwindConfigPath,
                    css: isAppRouter ? "app/globals.css" : "styles/globals.css"
                },
                aliases: {
                    components: "components",
                    utils: "lib/utils"
                }
            };
        }
        else if (frameworkDetection.framework === 'vite-react') {
            config = {
                style: "default",
                tsx: true,
                theme: selectedTheme,
                tailwind: {
                    config: isTailwindV4 ? "" : tailwindConfigPath,
                    css: "src/App.css"
                },
                aliases: {
                    components: "src/components",
                    utils: "src/lib/utils"
                }
            };
        }
        else if (frameworkDetection.framework === 'react-router') {
            config = {
                style: "default",
                tsx: true,
                theme: selectedTheme,
                tailwind: {
                    config: isTailwindV4 ? "" : tailwindConfigPath,
                    css: "app/app.css"
                },
                aliases: {
                    components: "app/components",
                    utils: "app/lib/utils"
                }
            };
        }
        else {
            // This shouldn't happen due to earlier validation, but just in case
            throw new Error('Unsupported framework configuration');
        }
        await (0, files_1.writeConfig)(config);
        // Install required dependencies
        spinner.text = 'Installing required dependencies...';
        const requiredDependencies = {
            'clsx': '^2.1.1',
            'tailwind-merge': '^3.3.1',
            'class-variance-authority': '^0.7.1'
        };
        try {
            await (0, files_1.installDependencies)(requiredDependencies);
        }
        catch (error) {
            spinner.warn('Dependencies installation failed, but you can install them manually');
            console.log(chalk_1.default.yellow('Run: npm install clsx tailwind-merge'));
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
        const utilsExists = await (0, files_1.fileExists)(utilsPath);
        let utilsCreated = false;
        if (utilsExists) {
            spinner.stop();
            console.log(chalk_1.default.yellow(`${utilsPath} already exists - skipping creation`));
            spinner.start();
        }
        else {
            await (0, files_1.writeComponentFile)(utilsPath, utilsContent);
            utilsCreated = true;
        }
        // Add design tokens
        spinner.text = 'Adding Nocta design tokens...';
        let tokensAdded = false;
        let tokensLocation = '';
        try {
            if (isTailwindV4) {
                // For Tailwind v4, add tokens to CSS file
                const cssPath = config.tailwind.css;
                const added = await (0, files_1.addDesignTokensToCss)(cssPath, selectedTheme);
                if (added) {
                    tokensAdded = true;
                    tokensLocation = cssPath;
                }
            }
            else {
                // For Tailwind v3, add tokens to tailwind config
                const configPath = config.tailwind.config;
                if (configPath) {
                    const added = await (0, files_1.addDesignTokensToTailwindConfig)(configPath, selectedTheme);
                    if (added) {
                        tokensAdded = true;
                        tokensLocation = configPath;
                    }
                }
                else {
                    // This shouldn't happen for v3, but create config if needed
                    const added = await (0, files_1.addDesignTokensToTailwindConfig)(tailwindConfigPath, selectedTheme);
                    if (added) {
                        tokensAdded = true;
                        tokensLocation = tailwindConfigPath;
                    }
                }
            }
        }
        catch (error) {
            spinner.warn('Design tokens installation failed, but you can add them manually');
            console.log(chalk_1.default.yellow('See documentation for manual token installation'));
        }
        spinner.succeed('nocta-ui initialized successfully!');
        console.log(chalk_1.default.green('\nConfiguration created:'));
        console.log(chalk_1.default.gray(`   nocta.config.json (${frameworkInfo})`));
        console.log(chalk_1.default.blue('\nTheme selected:'));
        console.log(chalk_1.default.gray(`   ${types_1.AVAILABLE_THEMES.find(t => t.name === selectedTheme)?.displayName} (${selectedTheme})`));
        console.log(chalk_1.default.blue('\nDependencies installed:'));
        console.log(chalk_1.default.gray(`   clsx@${requiredDependencies.clsx}`));
        console.log(chalk_1.default.gray(`   tailwind-merge@${requiredDependencies['tailwind-merge']}`));
        console.log(chalk_1.default.gray(`   class-variance-authority@${requiredDependencies['class-variance-authority']}`));
        if (utilsCreated) {
            console.log(chalk_1.default.green('\nUtility functions created:'));
            console.log(chalk_1.default.gray(`   ${utilsPath}`));
            console.log(chalk_1.default.gray(`   • cn() function for className merging`));
        }
        if (tokensAdded) {
            console.log(chalk_1.default.green('\nDesign tokens added:'));
            console.log(chalk_1.default.gray(`   ${tokensLocation}`));
            console.log(chalk_1.default.gray(`   • Nocta color palette (nocta-50 to nocta-950)`));
            console.log(chalk_1.default.gray(`   • Theme: ${types_1.AVAILABLE_THEMES.find(t => t.name === selectedTheme)?.displayName}`));
            if (isTailwindV4) {
                console.log(chalk_1.default.gray(`   • Use: text-nocta-500, bg-nocta-100, etc.`));
            }
            else {
                console.log(chalk_1.default.gray(`   • Use: text-nocta-500, bg-nocta-100, etc.`));
            }
        }
        else if (!tokensAdded && tokensLocation === '') {
            console.log(chalk_1.default.yellow('\nDesign tokens skipped (already exist or error occurred)'));
        }
        if (isTailwindV4) {
            console.log(chalk_1.default.blue('\nTailwind v4 detected!'));
            console.log(chalk_1.default.gray('   Make sure your CSS file includes @import "tailwindcss";'));
        }
        console.log(chalk_1.default.blue('\nYou can now add components:'));
        console.log(chalk_1.default.gray('   npx nocta-ui add button'));
    }
    catch (error) {
        spinner.fail('Failed to initialize nocta-ui');
        // Rollback any changes that might have been made
        try {
            await (0, files_1.rollbackInitChanges)();
            console.log(chalk_1.default.yellow('Rolled back partial changes'));
        }
        catch (rollbackError) {
            console.log(chalk_1.default.red('Could not rollback some changes - please check manually'));
        }
        throw error;
    }
}
