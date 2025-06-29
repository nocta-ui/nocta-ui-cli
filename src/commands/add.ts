import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { getComponent, getComponentFile, getComponentWithDependencies } from '../utils/registry';
import { readConfig, writeComponentFile, resolveComponentPath, installDependencies, fileExists } from '../utils/files';
import { ComponentFileWithContent } from '../types';

export async function add(componentName: string): Promise<void> {
  const spinner = ora(`Adding ${componentName}...`).start();

  try {
    const config = await readConfig();
    if (!config) {
      spinner.fail('Project not initialized');
      console.log(chalk.red('❌ components.json not found'));
      console.log(chalk.yellow('💡 Run "npx nocta-ui init" first'));
      return;
    }

    spinner.text = `Fetching ${componentName} component...`;
    const allComponents = await getComponentWithDependencies(componentName);
    const mainComponent = allComponents[allComponents.length - 1]; // Main component is last
    
    // Show user what will be installed
    if (allComponents.length > 1) {
      const dependencyNames = allComponents.slice(0, -1).map(c => c.name);
      spinner.stop();
      console.log(chalk.blue(`📦 Installing ${componentName} with internal dependencies:`));
      dependencyNames.forEach(name => {
        console.log(chalk.gray(`   • ${name}`));
      });
      console.log(chalk.gray(`   • ${mainComponent.name} (main component)`));
      console.log('');
      spinner.start(`Preparing components...`);
    }

    // Collect all files from all components
    const allComponentFiles: ComponentFileWithContent[] = [];
    for (const component of allComponents) {
      const files = await Promise.all(
        component.files.map(async (file) => {
          const content = await getComponentFile(file.path);
          return {
            ...file,
            content,
            componentName: component.name
          };
        })
      );
      allComponentFiles.push(...files);
    }

    spinner.text = `Checking existing files...`;
    
    // Check for existing files
    const existingFiles = [];
    for (const file of allComponentFiles) {
      const targetPath = resolveComponentPath(file.path, config);
      if (await fileExists(targetPath)) {
        existingFiles.push({ file, targetPath });
      }
    }

    // If files exist, ask user for confirmation
    if (existingFiles.length > 0) {
      spinner.stop();
      console.log(chalk.yellow(`\n⚠️  The following files already exist:`));
      existingFiles.forEach(({ targetPath }) => {
        console.log(chalk.gray(`   ${targetPath}`));
      });

      const { shouldOverwrite } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'shouldOverwrite',
          message: 'Do you want to overwrite these files?',
          default: false,
        },
      ]);

      if (!shouldOverwrite) {
        console.log(chalk.red('❌ Installation cancelled'));
        return;
      }
      
      spinner.start(`Installing ${componentName} files...`);
    } else {
      spinner.text = `Installing ${componentName} files...`;
    }
    
    for (const file of allComponentFiles) {
      const targetPath = resolveComponentPath(file.path, config);
      await writeComponentFile(targetPath, file.content);
    }

    // Collect all dependencies from all components
    const allDeps: Record<string, string> = {};
    for (const component of allComponents) {
      Object.assign(allDeps, component.dependencies);
    }
    
    const deps = Object.keys(allDeps);
    if (deps.length > 0) {
      spinner.text = `Installing dependencies...`;
      await installDependencies(allDeps);
    }

    spinner.succeed(`${mainComponent.name} added successfully!`);

    console.log(chalk.green('\n✅ Components installed:'));
    allComponentFiles.forEach((file) => {
      const targetPath = resolveComponentPath(file.path, config);
      console.log(chalk.gray(`   ${targetPath} (${file.componentName})`));
    });

    if (deps.length > 0) {
      console.log(chalk.blue('\n📦 Dependencies installed:'));
      deps.forEach(dep => {
        console.log(chalk.gray(`   ${dep}@${allDeps[dep]}`));
      });
    }

    console.log(chalk.blue('\n🚀 Import and use:'));
    const firstFile = mainComponent.files[0];
    const componentPath = firstFile.path.replace('components/', '').replace('.tsx', '');
    const importPath = `@/${config.aliases.components}/${componentPath}`;
    console.log(chalk.gray(`   import { ${mainComponent.exports.join(', ')} } from "${importPath}"`));

    if (mainComponent.variants && mainComponent.variants.length > 0) {
      console.log(chalk.blue('\n🎨 Available variants:'));
      console.log(chalk.gray(`   ${mainComponent.variants.join(', ')}`));
    }

    if (mainComponent.sizes && mainComponent.sizes.length > 0) {
      console.log(chalk.blue('\n📏 Available sizes:'));
      console.log(chalk.gray(`   ${mainComponent.sizes.join(', ')}`));
    }

  } catch (error) {
    spinner.fail(`Failed to add ${componentName}`);
    
    if (error instanceof Error) {
      if (error.message.includes('not found')) {
        console.log(chalk.red(`❌ Component "${componentName}" not found`));
        console.log(chalk.yellow('💡 Run "npx nocta-ui list" to see available components'));
      } else {
        console.log(chalk.red(`❌ ${error.message}`));
      }
    }
    
    throw error;
  }
}