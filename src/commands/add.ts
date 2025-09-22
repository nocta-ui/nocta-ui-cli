import chalk from "chalk";
import inquirer from "inquirer";
import ora from "ora";
import semver from "semver";
import type { ComponentFileWithContent } from "../types";
import {
	detectFramework,
	fileExists,
	getComponent,
	getComponentFile,
	getComponentWithDependencies,
	getInstalledDependencies,
	installDependencies,
	readConfig,
	resolveComponentPath,
	writeComponentFile,
} from "../utils";

function processComponentContent(content: string, framework: string): string {
	let processedContent = content;

	processedContent = processedContent.replace(
		/^(\s*(?:import|export).*?from\s+)(['"])\.\.\/([^'"]+)\2/gm,
		"$1$2./$3$2",
	);

	if (framework === "react-router") {
		processedContent = processedContent.replace(
			/^(\s*(?:import|export).*?from\s+)(['"])@\//gm,
			"$1$2~/",
		);
	}

	return processedContent;
}

export async function add(componentNames: string[]): Promise<void> {
	if (componentNames.length === 0) {
		console.log(chalk.red("Please specify at least one component name"));
		console.log(
			chalk.yellow(
				"Usage: npx nocta-ui add <component1> [component2] [component3] ...",
			),
		);
		return;
	}

	const spinner = ora(
		`Adding ${componentNames.length > 1 ? `${componentNames.length} components` : componentNames[0]}...`,
	).start();

	try {
		const config = await readConfig();
		if (!config) {
			spinner.fail("Project not initialized");
			console.log(chalk.red("nocta.config.json not found"));
			console.log(chalk.yellow('Run "npx nocta-ui init" first'));
			return;
		}

		spinner.text = "Detecting framework...";
		const frameworkDetection = await detectFramework();

		spinner.text = "Fetching components and dependencies...";
		const allComponentsMap = new Map();
		const processedComponents = new Set<string>();

		for (const componentName of componentNames) {
			try {
				const componentsWithDeps =
					await getComponentWithDependencies(componentName);

				for (const component of componentsWithDeps) {
					if (!processedComponents.has(component.name)) {
						allComponentsMap.set(component.name, component);
						processedComponents.add(component.name);
					}
				}
			} catch (error) {
				spinner.fail(`Failed to fetch component: ${componentName}`);
				if (error instanceof Error && error.message.includes("not found")) {
					console.log(chalk.red(`Component "${componentName}" not found`));
					console.log(
						chalk.yellow('Run "npx nocta-ui list" to see available components'),
					);
				}
				throw error;
			}
		}

		const allComponents = Array.from(allComponentsMap.values());
		const requestedComponents = componentNames
			.map((name) => {
				return allComponents.find((c) => {
					const registryKey =
						c.files[0].path.split("/").pop()?.replace(".tsx", "") || "";
					return (
						registryKey.toLowerCase() === name.toLowerCase() ||
						c.name.toLowerCase() === name.toLowerCase()
					);
				});
			})
			.filter(
				(component): component is NonNullable<typeof component> =>
					component !== undefined,
			);

		const requestedComponentNames = requestedComponents.map((c) => c!.name);
		const dependencies = allComponents.filter(
			(c) => !requestedComponentNames.includes(c.name),
		);

		spinner.stop();
		console.log(
			chalk.blue(
				`Installing ${componentNames.length} component${componentNames.length > 1 ? "s" : ""}:`,
			),
		);

		requestedComponents.forEach((component) => {
			console.log(chalk.green(`   • ${component!.name} (requested)`));
		});
		if (dependencies.length > 0) {
			console.log(chalk.blue("\nWith internal dependencies:"));
			dependencies.forEach((component) => {
				console.log(chalk.gray(`   • ${component.name}`));
			});
		}

		console.log("");
		spinner.start(`Preparing components...`);

		const allComponentFiles: ComponentFileWithContent[] = [];
		for (const component of allComponents) {
			const files = await Promise.all(
				component.files.map(async (file: any) => {
					const content = await getComponentFile(file.path);
					const processedContent = processComponentContent(
						content,
						frameworkDetection.framework,
					);
					return {
						...file,
						content: processedContent,
						componentName: component.name,
					};
				}),
			);
			allComponentFiles.push(...files);
		}

		spinner.text = `Checking existing files...`;

		const existingFiles = [];
		for (const file of allComponentFiles) {
			const targetPath = resolveComponentPath(file.path, config);
			if (await fileExists(targetPath)) {
				existingFiles.push({ file, targetPath });
			}
		}

		if (existingFiles.length > 0) {
			spinner.stop();
			console.log(chalk.yellow(`\nThe following files already exist:`));
			existingFiles.forEach(({ targetPath }) => {
				console.log(chalk.gray(`   ${targetPath}`));
			});

			const { shouldOverwrite } = await inquirer.prompt([
				{
					type: "confirm",
					name: "shouldOverwrite",
					message: "Do you want to overwrite these files?",
					default: false,
				},
			]);

			if (!shouldOverwrite) {
				console.log(chalk.red("Installation cancelled"));
				return;
			}

			spinner.start(`Installing component files...`);
		} else {
			spinner.text = `Installing component files...`;
		}

		for (const file of allComponentFiles) {
			const targetPath = resolveComponentPath(file.path, config);
			await writeComponentFile(targetPath, file.content);
		}

		const allDeps: Record<string, string> = {};
		for (const component of allComponents) {
			Object.assign(allDeps, component.dependencies);
		}

		const deps = Object.keys(allDeps);
		if (deps.length > 0) {
			spinner.text = `Checking dependencies...`;

			try {
				const installedDeps = await getInstalledDependencies();

				const depsToInstall: Record<string, string> = {};
				const skippedDeps: string[] = [];
				const incompatibleDeps: string[] = [];

				for (const [depName, requiredVersion] of Object.entries(allDeps)) {
					const installedVersion = installedDeps[depName];

					if (installedVersion) {
						try {
							const cleanInstalledVersion = installedVersion.replace(/^v/, "");
							const cleanRequiredVersion = requiredVersion.replace(
								/^[v^~]/,
								"",
							);

							if (depName === "react" || depName === "react-dom") {
								const installedMajor = semver.major(cleanInstalledVersion);
								const requiredMajor = semver.major(cleanRequiredVersion);

								if (installedMajor >= requiredMajor) {
									skippedDeps.push(
										`${depName}@${installedVersion} (newer version compatible with ${requiredVersion})`,
									);
									continue;
								}
							}

							const satisfies = semver.satisfies(
								cleanInstalledVersion,
								requiredVersion,
							);

							if (satisfies) {
								skippedDeps.push(
									`${depName}@${installedVersion} (satisfies ${requiredVersion})`,
								);
							} else {
								const installedMajor = semver.major(cleanInstalledVersion);
								const requiredMajor = semver.major(cleanRequiredVersion);

								if (installedMajor > requiredMajor) {
									skippedDeps.push(
										`${depName}@${installedVersion} (newer major version, assuming compatibility)`,
									);
								} else {
									incompatibleDeps.push(
										`${depName}: installed ${installedVersion}, required ${requiredVersion}`,
									);
									depsToInstall[depName] = requiredVersion;
								}
							}
						} catch (semverError) {
							const errorMessage =
								semverError instanceof Error
									? semverError.message
									: "Unknown error";
							console.log(
								chalk.yellow(
									`[WARN] Could not compare versions for ${depName}: ${errorMessage}`,
								),
							);
							depsToInstall[depName] = requiredVersion;
						}
					} else {
						depsToInstall[depName] = requiredVersion;
					}
				}

				if (Object.keys(depsToInstall).length > 0) {
					spinner.text = `Installing missing dependencies...`;
					await installDependencies(depsToInstall);
				}

				if (skippedDeps.length > 0) {
					console.log(chalk.green("\nDependencies already satisfied:"));
					skippedDeps.forEach((dep) => {
						console.log(chalk.gray(`   ${dep}`));
					});
				}

				if (incompatibleDeps.length > 0) {
					console.log(chalk.yellow("\nIncompatible dependencies updated:"));
					incompatibleDeps.forEach((dep) => {
						console.log(chalk.gray(`   ${dep}`));
					});
				}

				if (Object.keys(depsToInstall).length > 0) {
					console.log(chalk.blue("\nDependencies installed:"));
					Object.entries(depsToInstall).forEach(([dep, version]) => {
						console.log(chalk.gray(`   ${dep}@${version}`));
					});
				}
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : "Unknown error";
				console.log(
					chalk.yellow(
						`[WARN] Could not check existing dependencies: ${errorMessage}`,
					),
				);
				console.log(chalk.yellow("Installing all dependencies..."));
				spinner.text = `Installing dependencies...`;
				await installDependencies(allDeps);

				console.log(chalk.blue("\nDependencies installed:"));
				Object.entries(allDeps).forEach(([dep, version]) => {
					console.log(chalk.gray(`   ${dep}@${version}`));
				});
			}
		}

		const componentText =
			componentNames.length > 1
				? `${componentNames.length} components`
				: componentNames[0];
		spinner.succeed(`${componentText} added successfully!`);

		console.log(chalk.green("\nComponents installed:"));
		allComponentFiles.forEach((file) => {
			const targetPath = resolveComponentPath(file.path, config);
			console.log(chalk.gray(`   ${targetPath} (${file.componentName})`));
		});

		console.log(chalk.blue("\nImport and use:"));
		const aliasPrefix =
			frameworkDetection.framework === "react-router" ? "~" : "@";

		for (const componentName of componentNames) {
			const component = allComponents.find((c) => {
				const registryKey =
					c.files[0].path.split("/").pop()?.replace(".tsx", "") || "";
				return (
					registryKey.toLowerCase() === componentName.toLowerCase() ||
					c.name.toLowerCase() === componentName.toLowerCase()
				);
			});
			if (component) {
				const firstFile = component.files[0];
				const componentPath = firstFile.path
					.replace("components/", "")
					.replace(".tsx", "");
				const importPath = `${aliasPrefix}/${config.aliases.components}/${componentPath}`;
				console.log(
					chalk.gray(
						`   import { ${component.exports.join(", ")} } from "${importPath}"; // ${component.name}`,
					),
				);
			}
		}

		const componentsWithVariants = requestedComponents.filter(
			(c) => c!.variants && c!.variants.length > 0,
		);
		if (componentsWithVariants.length > 0) {
			console.log(chalk.blue("\nAvailable variants:"));
			componentsWithVariants.forEach((component) => {
				console.log(
					chalk.gray(
						`   ${component!.name}: ${component!.variants!.join(", ")}`,
					),
				);
			});
		}

		const componentsWithSizes = requestedComponents.filter(
			(c) => c!.sizes && c!.sizes.length > 0,
		);
		if (componentsWithSizes.length > 0) {
			console.log(chalk.blue("\nAvailable sizes:"));
			componentsWithSizes.forEach((component) => {
				console.log(
					chalk.gray(`   ${component!.name}: ${component!.sizes!.join(", ")}`),
				);
			});
		}
	} catch (error) {
		const componentText =
			componentNames.length > 1
				? `components: ${componentNames.join(", ")}`
				: componentNames[0];
		spinner.fail(`Failed to add ${componentText}`);

		if (error instanceof Error) {
			console.log(chalk.red(`${error.message}`));
		}

		throw error;
	}
}
