import { existsSync, readFileSync } from "fs";
import fs from "fs-extra";
import { join } from "path";

export async function getInstalledDependencies(): Promise<
	Record<string, string>
> {
	try {
		const packageJsonPath = join(process.cwd(), "package.json");

		if (!existsSync(packageJsonPath)) {
			return {};
		}

		const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

		const allDeps = {
			...packageJson.dependencies,
			...packageJson.devDependencies,
		};

		const actualVersions: Record<string, string> = {};

		for (const depName of Object.keys(allDeps)) {
			try {
				const nodeModulesPath = join(
					process.cwd(),
					"node_modules",
					depName,
					"package.json",
				);

				if (existsSync(nodeModulesPath)) {
					const depPackageJson = JSON.parse(
						readFileSync(nodeModulesPath, "utf8"),
					);
					actualVersions[depName] = depPackageJson.version;
				} else {
					actualVersions[depName] = allDeps[depName];
				}
			} catch {
				actualVersions[depName] = allDeps[depName];
			}
		}

		return actualVersions;
	} catch {
		return {};
	}
}

export async function installDependencies(
	dependencies: Record<string, string>,
): Promise<void> {
	const deps = Object.keys(dependencies);
	if (deps.length === 0) return;

	const { execSync } = require("child_process");

	let packageManager = "npm";
	if (await fs.pathExists("yarn.lock")) {
		packageManager = "yarn";
	} else if (await fs.pathExists("pnpm-lock.yaml")) {
		packageManager = "pnpm";
	}

	const installCmd =
		packageManager === "yarn"
			? `yarn add ${deps.join(" ")}`
			: packageManager === "pnpm"
				? `pnpm add ${deps.join(" ")}`
				: `npm install ${deps.join(" ")}`;

	console.log(`Installing dependencies with ${packageManager}...`);
	execSync(installCmd, { stdio: "inherit" });
}
