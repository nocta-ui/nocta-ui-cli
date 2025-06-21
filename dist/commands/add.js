"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.add = add;
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
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
        const component = await (0, registry_1.getComponent)(componentName);
        const componentFiles = await Promise.all(component.files.map(async (file) => {
            const content = await (0, registry_1.getComponentFile)(file.path);
            return {
                ...file,
                content
            };
        }));
        spinner.text = `Installing ${componentName} files...`;
        for (const file of componentFiles) {
            const targetPath = (0, files_1.resolveComponentPath)(file.path, config);
            await (0, files_1.writeComponentFile)(targetPath, file.content);
        }
        const deps = Object.keys(component.dependencies);
        if (deps.length > 0) {
            spinner.text = `Installing dependencies...`;
            await (0, files_1.installDependencies)(component.dependencies);
        }
        spinner.succeed(`${component.name} added successfully!`);
        console.log(chalk_1.default.green('\n✅ Component installed:'));
        componentFiles.forEach(file => {
            const targetPath = (0, files_1.resolveComponentPath)(file.path, config);
            console.log(chalk_1.default.gray(`   ${targetPath}`));
        });
        if (deps.length > 0) {
            console.log(chalk_1.default.blue('\n📦 Dependencies installed:'));
            deps.forEach(dep => {
                console.log(chalk_1.default.gray(`   ${dep}@${component.dependencies[dep]}`));
            });
        }
        console.log(chalk_1.default.blue('\n🚀 Import and use:'));
        const firstFile = component.files[0];
        const componentPath = firstFile.path.replace('components/', '').replace('.tsx', '');
        const importPath = `@/${config.aliases.components}/${componentPath}`;
        console.log(chalk_1.default.gray(`   import { ${component.exports.join(', ')} } from "${importPath}"`));
        if (component.variants && component.variants.length > 0) {
            console.log(chalk_1.default.blue('\n🎨 Available variants:'));
            console.log(chalk_1.default.gray(`   ${component.variants.join(', ')}`));
        }
        if (component.sizes && component.sizes.length > 0) {
            console.log(chalk_1.default.blue('\n📏 Available sizes:'));
            console.log(chalk_1.default.gray(`   ${component.sizes.join(', ')}`));
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
