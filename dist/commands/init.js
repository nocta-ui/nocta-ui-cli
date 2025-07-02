"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.init = init;
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const files_1 = require("../utils/files");
const fs_extra_1 = __importDefault(require("fs-extra"));
async function init() {
    const spinner = (0, ora_1.default)('Initializing nocta-ui...').start();
    try {
        const existingConfig = await (0, files_1.readConfig)();
        if (existingConfig) {
            spinner.stop();
            console.log(chalk_1.default.yellow('⚠️  components.json already exists!'));
            console.log(chalk_1.default.gray('Your project is already initialized.'));
            return;
        }
        // Check if Tailwind CSS is installed
        spinner.text = 'Checking Tailwind CSS installation...';
        const tailwindCheck = await (0, files_1.checkTailwindInstallation)();
        if (!tailwindCheck.installed) {
            spinner.fail('Tailwind CSS is required but not found!');
            console.log(chalk_1.default.red('\n❌ Tailwind CSS is not installed or not found in node_modules'));
            console.log(chalk_1.default.yellow('💡 Please install Tailwind CSS first:'));
            console.log(chalk_1.default.gray('   npm install -D tailwindcss'));
            console.log(chalk_1.default.gray('   # or'));
            console.log(chalk_1.default.gray('   yarn add -D tailwindcss'));
            console.log(chalk_1.default.gray('   # or'));
            console.log(chalk_1.default.gray('   pnpm add -D tailwindcss'));
            console.log(chalk_1.default.blue('\n📚 Visit https://tailwindcss.com/docs/installation for setup guide'));
            return;
        }
        spinner.text = `Found Tailwind CSS ${tailwindCheck.version} ✓`;
        const isNextJs = await fs_extra_1.default.pathExists('next.config.js') || await fs_extra_1.default.pathExists('next.config.mjs');
        const isVite = await fs_extra_1.default.pathExists('vite.config.js') || await fs_extra_1.default.pathExists('vite.config.ts');
        // Determine Tailwind version from already checked installation
        const isTailwindV4 = tailwindCheck.version ? (tailwindCheck.version.includes('^4') || tailwindCheck.version.includes('4.')) : false;
        let config;
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
        }
        else if (isVite) {
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
        }
        else {
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
        await (0, files_1.writeConfig)(config);
        // Install required dependencies
        spinner.text = 'Installing required dependencies...';
        const requiredDependencies = {
            'clsx': '^2.1.1',
            'tailwind-merge': '^3.3.1'
        };
        try {
            await (0, files_1.installDependencies)(requiredDependencies);
        }
        catch (error) {
            spinner.warn('Dependencies installation failed, but you can install them manually');
            console.log(chalk_1.default.yellow('💡 Run: npm install clsx tailwind-merge'));
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
            console.log(chalk_1.default.yellow(`⚠️  ${utilsPath} already exists - skipping creation`));
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
                const added = await (0, files_1.addDesignTokensToCss)(cssPath);
                if (added) {
                    tokensAdded = true;
                    tokensLocation = cssPath;
                }
            }
            else {
                // For Tailwind v3, add tokens to tailwind.config.js
                const configPath = config.tailwind.config;
                if (configPath) {
                    const added = await (0, files_1.addDesignTokensToTailwindConfig)(configPath);
                    if (added) {
                        tokensAdded = true;
                        tokensLocation = configPath;
                    }
                }
            }
        }
        catch (error) {
            spinner.warn('Design tokens installation failed, but you can add them manually');
            console.log(chalk_1.default.yellow('💡 See documentation for manual token installation'));
        }
        spinner.succeed('nocta-ui initialized successfully!');
        console.log(chalk_1.default.green('\n✅ Configuration created:'));
        console.log(chalk_1.default.gray(`   components.json`));
        console.log(chalk_1.default.blue('\n📦 Dependencies installed:'));
        console.log(chalk_1.default.gray(`   clsx@${requiredDependencies.clsx}`));
        console.log(chalk_1.default.gray(`   tailwind-merge@${requiredDependencies['tailwind-merge']}`));
        if (utilsCreated) {
            console.log(chalk_1.default.green('\n🔧 Utility functions created:'));
            console.log(chalk_1.default.gray(`   ${utilsPath}`));
            console.log(chalk_1.default.gray(`   • cn() function for className merging`));
        }
        if (tokensAdded) {
            console.log(chalk_1.default.green('\n🎨 Design tokens added:'));
            console.log(chalk_1.default.gray(`   ${tokensLocation}`));
            console.log(chalk_1.default.gray(`   • Nocta color palette (nocta-50 to nocta-950)`));
            if (isTailwindV4) {
                console.log(chalk_1.default.gray(`   • Use: text-nocta-500, bg-nocta-100, etc.`));
            }
            else {
                console.log(chalk_1.default.gray(`   • Use: text-nocta-500, bg-nocta-100, etc.`));
            }
        }
        else if (!tokensAdded && tokensLocation === '') {
            console.log(chalk_1.default.yellow('\n⚠️  Design tokens skipped (already exist or error occurred)'));
        }
        if (isTailwindV4) {
            console.log(chalk_1.default.blue('\n🎨 Tailwind v4 detected!'));
            console.log(chalk_1.default.gray('   Make sure your CSS file includes @import "tailwindcss";'));
        }
        console.log(chalk_1.default.blue('\n🚀 You can now add components:'));
        console.log(chalk_1.default.gray('   npx nocta-ui add button'));
    }
    catch (error) {
        spinner.fail('Failed to initialize nocta-ui');
        // Rollback any changes that might have been made
        try {
            await (0, files_1.rollbackInitChanges)();
            console.log(chalk_1.default.yellow('🔄 Rolled back partial changes'));
        }
        catch (rollbackError) {
            console.log(chalk_1.default.red('⚠️  Could not rollback some changes - please check manually'));
        }
        throw error;
    }
}
