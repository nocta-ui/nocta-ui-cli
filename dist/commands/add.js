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
async function add(componentNames) {
    if (componentNames.length === 0) {
        console.log(chalk_1.default.red('Please specify at least one component name'));
        console.log(chalk_1.default.yellow('Usage: npx nocta-ui add <component1> [component2] [component3] ...'));
        return;
    }
    const spinner = (0, ora_1.default)(`Adding ${componentNames.length > 1 ? `${componentNames.length} components` : componentNames[0]}...`).start();
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
        // Collect all components with their dependencies
        spinner.text = 'Fetching components and dependencies...';
        const allComponentsMap = new Map();
        const processedComponents = new Set();
        // Process each requested component
        for (const componentName of componentNames) {
            try {
                const componentsWithDeps = await (0, registry_1.getComponentWithDependencies)(componentName);
                // Add all components (including dependencies) to our map
                for (const component of componentsWithDeps) {
                    if (!processedComponents.has(component.name)) {
                        allComponentsMap.set(component.name, component);
                        processedComponents.add(component.name);
                    }
                }
            }
            catch (error) {
                spinner.fail(`Failed to fetch component: ${componentName}`);
                if (error instanceof Error && error.message.includes('not found')) {
                    console.log(chalk_1.default.red(`Component "${componentName}" not found`));
                    console.log(chalk_1.default.yellow('Run "npx nocta-ui list" to see available components'));
                }
                throw error;
            }
        }
        const allComponents = Array.from(allComponentsMap.values());
        const requestedComponents = componentNames.map(name => allComponents.find(c => c.name === name)).filter((component) => component !== undefined);
        // Show user what will be installed
        spinner.stop();
        console.log(chalk_1.default.blue(`Installing ${componentNames.length} component${componentNames.length > 1 ? 's' : ''}:`));
        requestedComponents.forEach(component => {
            console.log(chalk_1.default.green(`   • ${component.name} (requested)`));
        });
        // Show dependencies if any
        const dependencies = allComponents.filter(c => !componentNames.includes(c.name));
        if (dependencies.length > 0) {
            console.log(chalk_1.default.blue('\nWith internal dependencies:'));
            dependencies.forEach(component => {
                console.log(chalk_1.default.gray(`   • ${component.name}`));
            });
        }
        console.log('');
        spinner.start(`Preparing components...`);
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
            spinner.start(`Installing component files...`);
        }
        else {
            spinner.text = `Installing component files...`;
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
        const componentText = componentNames.length > 1 ? `${componentNames.length} components` : componentNames[0];
        spinner.succeed(`${componentText} added successfully!`);
        console.log(chalk_1.default.green('\nComponents installed:'));
        allComponentFiles.forEach((file) => {
            const targetPath = (0, files_1.resolveComponentPath)(file.path, config);
            console.log(chalk_1.default.gray(`   ${targetPath} (${file.componentName})`));
        });
        console.log(chalk_1.default.blue('\nImport and use:'));
        // Show import examples for each requested component
        const aliasPrefix = frameworkDetection.framework === 'react-router' ? '~' : '@';
        for (const componentName of componentNames) {
            const component = allComponents.find(c => c.name === componentName);
            if (component) {
                const firstFile = component.files[0];
                const componentPath = firstFile.path.replace('components/', '').replace('.tsx', '');
                const importPath = `${aliasPrefix}/${config.aliases.components}/${componentPath}`;
                console.log(chalk_1.default.gray(`   import { ${component.exports.join(', ')} } from "${importPath}"; // ${component.name}`));
            }
        }
        // Show variants and sizes for components that have them
        const componentsWithVariants = requestedComponents.filter(c => c.variants && c.variants.length > 0);
        if (componentsWithVariants.length > 0) {
            console.log(chalk_1.default.blue('\nAvailable variants:'));
            componentsWithVariants.forEach(component => {
                console.log(chalk_1.default.gray(`   ${component.name}: ${component.variants.join(', ')}`));
            });
        }
        const componentsWithSizes = requestedComponents.filter(c => c.sizes && c.sizes.length > 0);
        if (componentsWithSizes.length > 0) {
            console.log(chalk_1.default.blue('\nAvailable sizes:'));
            componentsWithSizes.forEach(component => {
                console.log(chalk_1.default.gray(`   ${component.name}: ${component.sizes.join(', ')}`));
            });
        }
    }
    catch (error) {
        const componentText = componentNames.length > 1 ? `components: ${componentNames.join(', ')}` : componentNames[0];
        spinner.fail(`Failed to add ${componentText}`);
        if (error instanceof Error) {
            console.log(chalk_1.default.red(`${error.message}`));
        }
        throw error;
    }
}
