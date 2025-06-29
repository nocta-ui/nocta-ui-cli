"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.add = add;
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const inquirer_1 = __importDefault(require("inquirer"));
const registry_1 = require("../utils/registry");
const files_1 = require("../utils/files");
async function add(componentName) {
    const spinner = (0, ora_1.default)(`Adding ${componentName}...`).start();
    try {
        const config = await (0, files_1.readConfig)();
        if (!config) {
            spinner.fail('Project not initialized');
            console.log(chalk_1.default.red('❌ components.json not found'));
            console.log(chalk_1.default.yellow('💡 Run "npx nocta-ui init" first'));
            return;
        }
        spinner.text = `Fetching ${componentName} component...`;
        const allComponents = await (0, registry_1.getComponentWithDependencies)(componentName);
        const mainComponent = allComponents[allComponents.length - 1]; // Main component is last
        // Show user what will be installed
        if (allComponents.length > 1) {
            const dependencyNames = allComponents.slice(0, -1).map(c => c.name);
            spinner.stop();
            console.log(chalk_1.default.blue(`📦 Installing ${componentName} with internal dependencies:`));
            dependencyNames.forEach(name => {
                console.log(chalk_1.default.gray(`   • ${name}`));
            });
            console.log(chalk_1.default.gray(`   • ${mainComponent.name} (main component)`));
            console.log('');
            spinner.start(`Preparing components...`);
        }
        // Collect all files from all components
        const allComponentFiles = [];
        for (const component of allComponents) {
            const files = await Promise.all(component.files.map(async (file) => {
                const content = await (0, registry_1.getComponentFile)(file.path);
                return {
                    ...file,
                    content,
                    componentName: component.name
                };
            }));
            allComponentFiles.push(...files);
        }
        spinner.text = `Checking existing files...`;
        // Check for existing files
        const existingFiles = [];
        for (const file of allComponentFiles) {
            const targetPath = (0, files_1.resolveComponentPath)(file.path, config);
            if (await (0, files_1.fileExists)(targetPath)) {
                existingFiles.push({ file, targetPath });
            }
        }
        // If files exist, ask user for confirmation
        if (existingFiles.length > 0) {
            spinner.stop();
            console.log(chalk_1.default.yellow(`\n⚠️  The following files already exist:`));
            existingFiles.forEach(({ targetPath }) => {
                console.log(chalk_1.default.gray(`   ${targetPath}`));
            });
            const { shouldOverwrite } = await inquirer_1.default.prompt([
                {
                    type: 'confirm',
                    name: 'shouldOverwrite',
                    message: 'Do you want to overwrite these files?',
                    default: false,
                },
            ]);
            if (!shouldOverwrite) {
                console.log(chalk_1.default.red('❌ Installation cancelled'));
                return;
            }
            spinner.start(`Installing ${componentName} files...`);
        }
        else {
            spinner.text = `Installing ${componentName} files...`;
        }
        for (const file of allComponentFiles) {
            const targetPath = (0, files_1.resolveComponentPath)(file.path, config);
            await (0, files_1.writeComponentFile)(targetPath, file.content);
        }
        // Collect all dependencies from all components
        const allDeps = {};
        for (const component of allComponents) {
            Object.assign(allDeps, component.dependencies);
        }
        const deps = Object.keys(allDeps);
        if (deps.length > 0) {
            spinner.text = `Installing dependencies...`;
            await (0, files_1.installDependencies)(allDeps);
        }
        spinner.succeed(`${mainComponent.name} added successfully!`);
        console.log(chalk_1.default.green('\n✅ Components installed:'));
        allComponentFiles.forEach((file) => {
            const targetPath = (0, files_1.resolveComponentPath)(file.path, config);
            console.log(chalk_1.default.gray(`   ${targetPath} (${file.componentName})`));
        });
        if (deps.length > 0) {
            console.log(chalk_1.default.blue('\n📦 Dependencies installed:'));
            deps.forEach(dep => {
                console.log(chalk_1.default.gray(`   ${dep}@${allDeps[dep]}`));
            });
        }
        console.log(chalk_1.default.blue('\n🚀 Import and use:'));
        const firstFile = mainComponent.files[0];
        const componentPath = firstFile.path.replace('components/', '').replace('.tsx', '');
        const importPath = `@/${config.aliases.components}/${componentPath}`;
        console.log(chalk_1.default.gray(`   import { ${mainComponent.exports.join(', ')} } from "${importPath}"`));
        if (mainComponent.variants && mainComponent.variants.length > 0) {
            console.log(chalk_1.default.blue('\n🎨 Available variants:'));
            console.log(chalk_1.default.gray(`   ${mainComponent.variants.join(', ')}`));
        }
        if (mainComponent.sizes && mainComponent.sizes.length > 0) {
            console.log(chalk_1.default.blue('\n📏 Available sizes:'));
            console.log(chalk_1.default.gray(`   ${mainComponent.sizes.join(', ')}`));
        }
    }
    catch (error) {
        spinner.fail(`Failed to add ${componentName}`);
        if (error instanceof Error) {
            if (error.message.includes('not found')) {
                console.log(chalk_1.default.red(`❌ Component "${componentName}" not found`));
                console.log(chalk_1.default.yellow('💡 Run "npx nocta-ui list" to see available components'));
            }
            else {
                console.log(chalk_1.default.red(`❌ ${error.message}`));
            }
        }
        throw error;
    }
}
