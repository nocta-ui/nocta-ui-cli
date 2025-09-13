"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.init = init;
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const utils_1 = require("../utils");
async function init() {
    const spinner = (0, ora_1.default)('Initializing nocta-ui...').start();
    try {
        const existingConfig = await (0, utils_1.readConfig)();
        if (existingConfig) {
            spinner.stop();
            console.log(chalk_1.default.yellow('nocta.config.json already exists!'));
            console.log(chalk_1.default.gray('Your project is already initialized.'));
            return;
        }
        spinner.text = 'Checking Tailwind CSS installation...';
        const tailwindCheck = await (0, utils_1.checkTailwindInstallation)();
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
        spinner.text = 'Detecting project framework...';
        const frameworkDetection = await (0, utils_1.detectFramework)();
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
        const versionStr = tailwindCheck.version || '';
        const majorMatch = versionStr.match(/[\^~]?(\d+)(?:\.|\b)/);
        const major = majorMatch ? parseInt(majorMatch[1], 10) : (/latest/i.test(versionStr) ? 4 : 0);
        const isTailwindV4 = major >= 4;
        if (!isTailwindV4) {
            spinner.fail('Tailwind CSS v4 is required');
            console.log(chalk_1.default.red('\nDetected Tailwind version that is not v4: ' + (tailwindCheck.version || 'unknown')));
            console.log(chalk_1.default.yellow('Please upgrade to Tailwind CSS v4:'));
            console.log(chalk_1.default.gray('   npm install -D tailwindcss@latest'));
            console.log(chalk_1.default.gray('   # or'));
            console.log(chalk_1.default.gray('   yarn add -D tailwindcss@latest'));
            console.log(chalk_1.default.gray('   # or'));
            console.log(chalk_1.default.gray('   pnpm add -D tailwindcss@latest'));
            return;
        }
        spinner.stop();
        spinner.start('Creating configuration...');
        let config;
        if (frameworkDetection.framework === 'nextjs') {
            const isAppRouter = frameworkDetection.details.appStructure === 'app-router';
            config = {
                style: "default",
                tsx: true,
                tailwind: {
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
                tailwind: {
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
                tailwind: {
                    css: "app/app.css"
                },
                aliases: {
                    components: "app/components",
                    utils: "app/lib/utils"
                }
            };
        }
        else {
            throw new Error('Unsupported framework configuration');
        }
        await (0, utils_1.writeConfig)(config);
        spinner.text = 'Installing required dependencies...';
        const requiredDependencies = {
            'clsx': '^2.1.1',
            'tailwind-merge': '^3.3.1',
            'class-variance-authority': '^0.7.1',
            '@ariakit/react': '^0.4.18'
        };
        try {
            await (0, utils_1.installDependencies)(requiredDependencies);
        }
        catch (error) {
            spinner.warn('Dependencies installation failed, but you can install them manually');
            console.log(chalk_1.default.yellow('Run: npm install clsx tailwind-merge'));
        }
        spinner.text = 'Creating utility functions...';
        const utilsContent = `import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`;
        const utilsPath = `${config.aliases.utils}.ts`;
        const utilsExists = await (0, utils_1.fileExists)(utilsPath);
        let utilsCreated = false;
        if (utilsExists) {
            spinner.stop();
            console.log(chalk_1.default.yellow(`${utilsPath} already exists - skipping creation`));
            spinner.start();
        }
        else {
            await (0, utils_1.writeComponentFile)(utilsPath, utilsContent);
            utilsCreated = true;
        }
        spinner.text = 'Adding semantic color variables...';
        let tokensAdded = false;
        let tokensLocation = '';
        try {
            const cssPath = config.tailwind.css;
            const added = await (0, utils_1.addDesignTokensToCss)(cssPath);
            if (added) {
                tokensAdded = true;
                tokensLocation = cssPath;
            }
        }
        catch (error) {
            spinner.warn('Design tokens installation failed, but you can add them manually');
            console.log(chalk_1.default.yellow('See documentation for manual token installation'));
        }
        spinner.succeed('nocta-ui initialized successfully!');
        console.log(chalk_1.default.green('\nConfiguration created:'));
        console.log(chalk_1.default.gray(`   nocta.config.json (${frameworkInfo})`));
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
            console.log(chalk_1.default.green('\nColor variables added:'));
            console.log(chalk_1.default.gray(`   ${tokensLocation}`));
            console.log(chalk_1.default.gray(`   • Semantic tokens (background, foreground, primary, border, etc.)`));
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
        try {
            await (0, utils_1.rollbackInitChanges)();
            console.log(chalk_1.default.yellow('Rolled back partial changes'));
        }
        catch (rollbackError) {
            console.log(chalk_1.default.red('Could not rollback some changes - please check manually'));
        }
        throw error;
    }
}
