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
const semver_1 = __importDefault(require("semver"));
function processComponentContent(content, framework) {
    // For React Router 7, replace @ alias with ~ alias
    if (framework === 'react-router') {
        return content.replace(/from\s+(['"])@\//g, "from $1~/");
    }
    // For other frameworks (Next.js, Vite), keep @ alias
    return content;
}
async function add(componentName) {
    const spinner = (0, ora_1.default)(`Adding ${componentName}...`).start();
    try {
        const config = await (0, files_1.readConfig)();
        if (!config) {
            spinner.fail('Project not initialized');
            console.log(chalk_1.default.red('nocta.config.json not found'));
            console.log(chalk_1.default.yellow('Run "npx nocta-ui init" first'));
            return;
        }
        // Detect framework to determine the correct import alias
        spinner.text = 'Detecting framework...';
        const frameworkDetection = await (0, files_1.detectFramework)();
        spinner.text = `Fetching ${componentName} component...`;
        const allComponents = await (0, registry_1.getComponentWithDependencies)(componentName);
        const mainComponent = allComponents[allComponents.length - 1]; // Main component is last
        // Show user what will be installed
        if (allComponents.length > 1) {
            const dependencyNames = allComponents.slice(0, -1).map(c => c.name);
            spinner.stop();
            console.log(chalk_1.default.blue(`Installing ${componentName} with internal dependencies:`));
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
                // Process content to use correct import alias based on framework
                const processedContent = processComponentContent(content, frameworkDetection.framework);
                return {
                    ...file,
                    content: processedContent,
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
            console.log(chalk_1.default.yellow(`\nThe following files already exist:`));
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
                console.log(chalk_1.default.red('Installation cancelled'));
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
            spinner.text = `Checking dependencies...`;
            try {
                // Get currently installed dependencies
                const installedDeps = await (0, files_1.getInstalledDependencies)();
                // Filter out dependencies that are already installed and satisfy requirements
                const depsToInstall = {};
                const skippedDeps = [];
                const incompatibleDeps = [];
                for (const [depName, requiredVersion] of Object.entries(allDeps)) {
                    const installedVersion = installedDeps[depName];
                    if (installedVersion) {
                        try {
                            // Clean version strings - remove 'v' prefix if present
                            const cleanInstalledVersion = installedVersion.replace(/^v/, '');
                            const cleanRequiredVersion = requiredVersion.replace(/^[v^~]/, ''); // Remove ^, ~, v prefixes
                            // Special handling for React - newer major versions are usually compatible
                            if (depName === 'react' || depName === 'react-dom') {
                                const installedMajor = semver_1.default.major(cleanInstalledVersion);
                                const requiredMajor = semver_1.default.major(cleanRequiredVersion);
                                // If installed version is newer major version, assume compatibility
                                if (installedMajor >= requiredMajor) {
                                    skippedDeps.push(`${depName}@${installedVersion} (newer version compatible with ${requiredVersion})`);
                                    continue;
                                }
                            }
                            // Check if installed version satisfies the requirement
                            const satisfies = semver_1.default.satisfies(cleanInstalledVersion, requiredVersion);
                            if (satisfies) {
                                skippedDeps.push(`${depName}@${installedVersion} (satisfies ${requiredVersion})`);
                            }
                            else {
                                // For other packages, check if it's a newer major version
                                const installedMajor = semver_1.default.major(cleanInstalledVersion);
                                const requiredMajor = semver_1.default.major(cleanRequiredVersion);
                                if (installedMajor > requiredMajor) {
                                    skippedDeps.push(`${depName}@${installedVersion} (newer major version, assuming compatibility)`);
                                }
                                else {
                                    incompatibleDeps.push(`${depName}: installed ${installedVersion}, required ${requiredVersion}`);
                                    depsToInstall[depName] = requiredVersion;
                                }
                            }
                        }
                        catch (semverError) {
                            const errorMessage = semverError instanceof Error ? semverError.message : 'Unknown error';
                            console.log(chalk_1.default.yellow(`[WARN] Could not compare versions for ${depName}: ${errorMessage}`));
                            depsToInstall[depName] = requiredVersion;
                        }
                    }
                    else {
                        depsToInstall[depName] = requiredVersion;
                    }
                }
                // Install only missing or incompatible dependencies
                if (Object.keys(depsToInstall).length > 0) {
                    spinner.text = `Installing missing dependencies...`;
                    await (0, files_1.installDependencies)(depsToInstall);
                }
                // Show information about dependency handling
                if (skippedDeps.length > 0) {
                    console.log(chalk_1.default.green('\nDependencies already satisfied:'));
                    skippedDeps.forEach(dep => {
                        console.log(chalk_1.default.gray(`   ${dep}`));
                    });
                }
                if (incompatibleDeps.length > 0) {
                    console.log(chalk_1.default.yellow('\nIncompatible dependencies updated:'));
                    incompatibleDeps.forEach(dep => {
                        console.log(chalk_1.default.gray(`   ${dep}`));
                    });
                }
                if (Object.keys(depsToInstall).length > 0) {
                    console.log(chalk_1.default.blue('\nDependencies installed:'));
                    Object.entries(depsToInstall).forEach(([dep, version]) => {
                        console.log(chalk_1.default.gray(`   ${dep}@${version}`));
                    });
                }
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                console.log(chalk_1.default.yellow(`[WARN] Could not check existing dependencies: ${errorMessage}`));
                console.log(chalk_1.default.yellow('Installing all dependencies...'));
                spinner.text = `Installing dependencies...`;
                await (0, files_1.installDependencies)(allDeps);
                console.log(chalk_1.default.blue('\nDependencies installed:'));
                Object.entries(allDeps).forEach(([dep, version]) => {
                    console.log(chalk_1.default.gray(`   ${dep}@${version}`));
                });
            }
        }
        spinner.succeed(`${mainComponent.name} added successfully!`);
        console.log(chalk_1.default.green('\nComponents installed:'));
        allComponentFiles.forEach((file) => {
            const targetPath = (0, files_1.resolveComponentPath)(file.path, config);
            console.log(chalk_1.default.gray(`   ${targetPath} (${file.componentName})`));
        });
        console.log(chalk_1.default.blue('\nImport and use:'));
        const firstFile = mainComponent.files[0];
        const componentPath = firstFile.path.replace('components/', '').replace('.tsx', '');
        // Use correct alias based on framework
        const aliasPrefix = frameworkDetection.framework === 'react-router' ? '~' : '@';
        const importPath = `${aliasPrefix}/${config.aliases.components}/${componentPath}`;
        console.log(chalk_1.default.gray(`   import { ${mainComponent.exports.join(', ')} } from "${importPath}"`));
        if (mainComponent.variants && mainComponent.variants.length > 0) {
            console.log(chalk_1.default.blue('\nAvailable variants:'));
            console.log(chalk_1.default.gray(`   ${mainComponent.variants.join(', ')}`));
        }
        if (mainComponent.sizes && mainComponent.sizes.length > 0) {
            console.log(chalk_1.default.blue('\nAvailable sizes:'));
            console.log(chalk_1.default.gray(`   ${mainComponent.sizes.join(', ')}`));
        }
    }
    catch (error) {
        spinner.fail(`Failed to add ${componentName}`);
        if (error instanceof Error) {
            if (error.message.includes('not found')) {
                console.log(chalk_1.default.red(`Component "${componentName}" not found`));
                console.log(chalk_1.default.yellow('Run "npx nocta-ui list" to see available components'));
            }
            else {
                console.log(chalk_1.default.red(`${error.message}`));
            }
        }
        throw error;
    }
}
