import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { getComponent, getComponentFile } from '../utils/registry';
import { readConfig, writeComponentFile, resolveComponentPath, installDependencies, fileExists } from '../utils/files';

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
    const component = await getComponent(componentName);

    const componentFiles = await Promise.all(
      component.files.map(async (file) => {
        const content = await getComponentFile(file.path);
        return {
          ...file,
          content
        };
      })
    );

    spinner.text = `Checking existing files...`;
    
    // Check for existing files
    const existingFiles = [];
    for (const file of componentFiles) {
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
    
    for (const file of componentFiles) {
      const targetPath = resolveComponentPath(file.path, config);
      await writeComponentFile(targetPath, file.content);
    }

    const deps = Object.keys(component.dependencies);
    if (deps.length > 0) {
      spinner.text = `Installing dependencies...`;
      await installDependencies(component.dependencies);
    }

    spinner.succeed(`${component.name} added successfully!`);

    console.log(chalk.green('\n✅ Component installed:'));
    componentFiles.forEach(file => {
      const targetPath = resolveComponentPath(file.path, config);
      console.log(chalk.gray(`   ${targetPath}`));
    });

    if (deps.length > 0) {
      console.log(chalk.blue('\n📦 Dependencies installed:'));
      deps.forEach(dep => {
        console.log(chalk.gray(`   ${dep}@${component.dependencies[dep]}`));
      });
    }

    console.log(chalk.blue('\n🚀 Import and use:'));
    const firstFile = component.files[0];
    const componentPath = firstFile.path.replace('components/', '').replace('.tsx', '');
    const importPath = `@/${config.aliases.components}/${componentPath}`;
    console.log(chalk.gray(`   import { ${component.exports.join(', ')} } from "${importPath}"`));

    if (component.variants && component.variants.length > 0) {
      console.log(chalk.blue('\n🎨 Available variants:'));
      console.log(chalk.gray(`   ${component.variants.join(', ')}`));
    }

    if (component.sizes && component.sizes.length > 0) {
      console.log(chalk.blue('\n📏 Available sizes:'));
      console.log(chalk.gray(`   ${component.sizes.join(', ')}`));
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