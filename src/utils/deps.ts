import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import fs from "fs-extra";
import { gte, minVersion, satisfies } from "semver";

export interface RequirementIssue {
	name: string;
	required: string;
	installed?: string;
	declared?: string;
	reason: "missing" | "outdated" | "unknown";
}

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

	let packageManager = "npm";
	if (await fs.pathExists("yarn.lock")) {
		packageManager = "yarn";
	} else if (await fs.pathExists("pnpm-lock.yaml")) {
		packageManager = "pnpm";
	}

	const depsWithVersions = deps.map(
		(depName) => `${depName}@${dependencies[depName]}`,
	);

	const installCmd =
		packageManager === "yarn"
			? `yarn add ${depsWithVersions.join(" ")}`
			: packageManager === "pnpm"
				? `pnpm add ${depsWithVersions.join(" ")}`
				: `npm install ${depsWithVersions.join(" ")}`;

	console.log(`Installing dependencies with ${packageManager}...`);
	execSync(installCmd, { stdio: "inherit" });
}

export async function checkProjectRequirements(
	requirements: Record<string, string>,
): Promise<RequirementIssue[]> {
	const installed = await getInstalledDependencies();
	const issues: RequirementIssue[] = [];

	for (const [name, requiredRange] of Object.entries(requirements)) {
		const installedSpec = installed[name];
		if (!installedSpec) {
			issues.push({
				name,
				required: requiredRange,
				reason: "missing",
			});
			continue;
		}

		const modulePackagePath = join(
			process.cwd(),
			"node_modules",
			...name.split("/"),
			"package.json",
		);
		if (!existsSync(modulePackagePath)) {
			issues.push({
				name,
				required: requiredRange,
				declared: installedSpec,
				reason: "missing",
			});
			continue;
		}

		const resolvedVersion = minVersion(installedSpec);
		const minimumRequired = minVersion(requiredRange);
		const rangeSatisfied = resolvedVersion
			? satisfies(resolvedVersion, requiredRange, {
					includePrerelease: true,
				})
			: false;
		const higherVersionSatisfied =
			resolvedVersion && minimumRequired
				? gte(resolvedVersion, minimumRequired)
				: false;

		if (!resolvedVersion || (!rangeSatisfied && !higherVersionSatisfied)) {
			const normalizedVersion = resolvedVersion?.version;
			issues.push({
				name,
				required: requiredRange,
				installed: normalizedVersion,
				declared:
					normalizedVersion && normalizedVersion === installedSpec
						? undefined
						: installedSpec,
				reason: resolvedVersion ? "outdated" : "unknown",
			});
		}
	}

	return issues;
}
