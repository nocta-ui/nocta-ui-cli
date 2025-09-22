import chalk from "chalk";
import ora from "ora";
import type { Config } from "../types";
import {
	addDesignTokensToCss,
	checkTailwindInstallation,
	detectFramework,
	fileExists,
	installDependencies,
	readConfig,
	rollbackInitChanges,
	writeComponentFile,
	writeConfig,
} from "../utils";

export async function init(): Promise<void> {
	const spinner = ora("Initializing nocta-ui...").start();

	try {
		const existingConfig = await readConfig();
		if (existingConfig) {
			spinner.stop();
			console.log(chalk.yellow("nocta.config.json already exists!"));
			console.log(chalk.gray("Your project is already initialized."));
			return;
		}

		spinner.text = "Checking Tailwind CSS installation...";
		const tailwindCheck = await checkTailwindInstallation();

		if (!tailwindCheck.installed) {
			spinner.fail("Tailwind CSS is required but not found!");
			console.log(
				chalk.red(
					"\nTailwind CSS is not installed or not found in node_modules",
				),
			);
			console.log(chalk.yellow("Please install Tailwind CSS first:"));
			console.log(chalk.gray("   npm install -D tailwindcss"));
			console.log(chalk.gray("   # or"));
			console.log(chalk.gray("   yarn add -D tailwindcss"));
			console.log(chalk.gray("   # or"));
			console.log(chalk.gray("   pnpm add -D tailwindcss"));
			console.log(
				chalk.blue(
					"\nVisit https://tailwindcss.com/docs/installation for setup guide",
				),
			);
			return;
		}

		spinner.text = `Found Tailwind CSS ${tailwindCheck.version} ✓`;

		spinner.text = "Detecting project framework...";
		const frameworkDetection = await detectFramework();

		if (frameworkDetection.framework === "unknown") {
			spinner.fail("Unsupported project structure detected!");
			console.log(chalk.red("\nCould not detect a supported React framework"));
			console.log(chalk.yellow("nocta-ui supports:"));
			console.log(chalk.gray("   • Next.js (App Router or Pages Router)"));
			console.log(chalk.gray("   • Vite + React"));
			console.log(chalk.gray("   • React Router 7 (Framework Mode)"));
			console.log(chalk.blue("\nDetection details:"));
			console.log(
				chalk.gray(
					`   React dependency: ${frameworkDetection.details.hasReactDependency ? "✓" : "✗"}`,
				),
			);
			console.log(
				chalk.gray(
					`   Framework config: ${frameworkDetection.details.hasConfig ? "✓" : "✗"}`,
				),
			);
			console.log(
				chalk.gray(
					`   Config files found: ${frameworkDetection.details.configFiles.join(", ") || "none"}`,
				),
			);

			if (!frameworkDetection.details.hasReactDependency) {
				console.log(chalk.yellow("\nInstall React first:"));
				console.log(chalk.gray("   npm install react react-dom"));
				console.log(
					chalk.gray("   npm install -D @types/react @types/react-dom"),
				);
			} else {
				console.log(chalk.yellow("\nSet up a supported framework:"));
				console.log(chalk.blue("   Next.js:"));
				console.log(chalk.gray("     npx create-next-app@latest"));
				console.log(chalk.blue("   Vite + React:"));
				console.log(
					chalk.gray("     npm create vite@latest . -- --template react-ts"),
				);
				console.log(chalk.blue("   React Router 7:"));
				console.log(chalk.gray("     npx create-react-router@latest"));
			}
			return;
		}

		let frameworkInfo = "";
		if (frameworkDetection.framework === "nextjs") {
			const routerType = frameworkDetection.details.appStructure;
			frameworkInfo = `Next.js ${frameworkDetection.version || ""} (${routerType === "app-router" ? "App Router" : routerType === "pages-router" ? "Pages Router" : "Unknown Router"})`;
		} else if (frameworkDetection.framework === "vite-react") {
			frameworkInfo = `Vite ${frameworkDetection.version || ""} + React`;
		} else if (frameworkDetection.framework === "react-router") {
			frameworkInfo = `React Router ${frameworkDetection.version || ""} (Framework Mode)`;
		}

		spinner.text = `Found ${frameworkInfo} ✓`;

		const versionStr = tailwindCheck.version || "";
		const majorMatch = versionStr.match(/[\^~]?(\d+)(?:\.|\b)/);
		const major = majorMatch
			? parseInt(majorMatch[1], 10)
			: /latest/i.test(versionStr)
				? 4
				: 0;
		const isTailwindV4 = major >= 4;
		if (!isTailwindV4) {
			spinner.fail("Tailwind CSS v4 is required");
			console.log(
				chalk.red(
					"\nDetected Tailwind version that is not v4: " +
						(tailwindCheck.version || "unknown"),
				),
			);
			console.log(chalk.yellow("Please upgrade to Tailwind CSS v4:"));
			console.log(chalk.gray("   npm install -D tailwindcss@latest"));
			console.log(chalk.gray("   # or"));
			console.log(chalk.gray("   yarn add -D tailwindcss@latest"));
			console.log(chalk.gray("   # or"));
			console.log(chalk.gray("   pnpm add -D tailwindcss@latest"));
			return;
		}

		spinner.stop();
		spinner.start("Creating configuration...");

		let config: Config;

		if (frameworkDetection.framework === "nextjs") {
			const isAppRouter =
				frameworkDetection.details.appStructure === "app-router";
			config = {
				style: "default",
				tsx: true,
				tailwind: {
					css: isAppRouter ? "app/globals.css" : "styles/globals.css",
				},
				aliases: {
					components: "components",
					utils: "lib/utils",
				},
			};
		} else if (frameworkDetection.framework === "vite-react") {
			config = {
				style: "default",
				tsx: true,
				tailwind: {
					css: "src/App.css",
				},
				aliases: {
					components: "src/components",
					utils: "src/lib/utils",
				},
			};
		} else if (frameworkDetection.framework === "react-router") {
			config = {
				style: "default",
				tsx: true,
				tailwind: {
					css: "app/app.css",
				},
				aliases: {
					components: "app/components",
					utils: "app/lib/utils",
				},
			};
		} else {
			throw new Error("Unsupported framework configuration");
		}

		await writeConfig(config);

		spinner.text = "Installing required dependencies...";
		const requiredDependencies = {
			clsx: "^2.1.1",
			"tailwind-merge": "^3.3.1",
			"class-variance-authority": "^0.7.1",
			"@ariakit/react": "^0.4.18",
			"@radix-ui/react-icons": "^1.3.2"
		};

		try {
			await installDependencies(requiredDependencies);
		} catch (error) {
			spinner.warn(
				"Dependencies installation failed, but you can install them manually",
			);
			console.log(chalk.yellow("Run: npm install clsx tailwind-merge"));
		}

		spinner.text = "Creating utility functions...";
		const utilsContent = `import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`;

		const utilsPath = `${config.aliases.utils}.ts`;
		const utilsExists = await fileExists(utilsPath);
		let utilsCreated = false;

		if (utilsExists) {
			spinner.stop();
			console.log(
				chalk.yellow(`${utilsPath} already exists - skipping creation`),
			);
			spinner.start();
		} else {
			await writeComponentFile(utilsPath, utilsContent);
			utilsCreated = true;
		}

		spinner.text = "Adding semantic color variables...";
		let tokensAdded = false;
		let tokensLocation = "";

		try {
			const cssPath = config.tailwind.css;
			const added = await addDesignTokensToCss(cssPath);
			if (added) {
				tokensAdded = true;
				tokensLocation = cssPath;
			}
		} catch (error) {
			spinner.warn(
				"Design tokens installation failed, but you can add them manually",
			);
			console.log(
				chalk.yellow("See documentation for manual token installation"),
			);
		}

		spinner.succeed("nocta-ui initialized successfully!");

		console.log(chalk.green("\nConfiguration created:"));
		console.log(chalk.gray(`   nocta.config.json (${frameworkInfo})`));

		console.log(chalk.blue("\nDependencies installed:"));
		console.log(chalk.gray(`   clsx@${requiredDependencies.clsx}`));
		console.log(
			chalk.gray(`   tailwind-merge@${requiredDependencies["tailwind-merge"]}`),
		);
		console.log(
			chalk.gray(
				`   class-variance-authority@${requiredDependencies["class-variance-authority"]}`,
			),
		);

		if (utilsCreated) {
			console.log(chalk.green("\nUtility functions created:"));
			console.log(chalk.gray(`   ${utilsPath}`));
			console.log(chalk.gray(`   • cn() function for className merging`));
		}

		if (tokensAdded) {
			console.log(chalk.green("\nColor variables added:"));
			console.log(chalk.gray(`   ${tokensLocation}`));
			console.log(
				chalk.gray(
					`   • Semantic tokens (background, foreground, primary, border, etc.)`,
				),
			);
		} else if (!tokensAdded && tokensLocation === "") {
			console.log(
				chalk.yellow(
					"\nDesign tokens skipped (already exist or error occurred)",
				),
			);
		}

		if (isTailwindV4) {
			console.log(chalk.blue("\nTailwind v4 detected!"));
			console.log(
				chalk.gray(
					'   Make sure your CSS file includes @import "tailwindcss";',
				),
			);
		}

		console.log(chalk.blue("\nYou can now add components:"));
		console.log(chalk.gray("   npx nocta-ui add button"));
	} catch (error) {
		spinner.fail("Failed to initialize nocta-ui");

		try {
			await rollbackInitChanges();
			console.log(chalk.yellow("Rolled back partial changes"));
		} catch (rollbackError) {
			console.log(
				chalk.red("Could not rollback some changes - please check manually"),
			);
		}

		throw error;
	}
}
