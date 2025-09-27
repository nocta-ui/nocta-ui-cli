"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getInstalledDependencies = getInstalledDependencies;
exports.installDependencies = installDependencies;
exports.checkProjectRequirements = checkProjectRequirements;
const node_path_1 = require("node:path");
const fs_1 = require("fs");
const fs_extra_1 = __importDefault(require("fs-extra"));
const semver_1 = require("semver");
async function getInstalledDependencies() {
    try {
        const packageJsonPath = (0, node_path_1.join)(process.cwd(), "package.json");
        if (!(0, fs_1.existsSync)(packageJsonPath)) {
            return {};
        }
        const packageJson = JSON.parse((0, fs_1.readFileSync)(packageJsonPath, "utf8"));
        const allDeps = {
            ...packageJson.dependencies,
            ...packageJson.devDependencies,
        };
        const actualVersions = {};
        for (const depName of Object.keys(allDeps)) {
            try {
                const nodeModulesPath = (0, node_path_1.join)(process.cwd(), "node_modules", depName, "package.json");
                if ((0, fs_1.existsSync)(nodeModulesPath)) {
                    const depPackageJson = JSON.parse((0, fs_1.readFileSync)(nodeModulesPath, "utf8"));
                    actualVersions[depName] = depPackageJson.version;
                }
                else {
                    actualVersions[depName] = allDeps[depName];
                }
            }
            catch {
                actualVersions[depName] = allDeps[depName];
            }
        }
        return actualVersions;
    }
    catch {
        return {};
    }
}
async function installDependencies(dependencies) {
    const deps = Object.keys(dependencies);
    if (deps.length === 0)
        return;
    const { execSync } = require("child_process");
    let packageManager = "npm";
    if (await fs_extra_1.default.pathExists("yarn.lock")) {
        packageManager = "yarn";
    }
    else if (await fs_extra_1.default.pathExists("pnpm-lock.yaml")) {
        packageManager = "pnpm";
    }
    const depsWithVersions = deps.map((depName) => `${depName}@${dependencies[depName]}`);
    const installCmd = packageManager === "yarn"
        ? `yarn add ${depsWithVersions.join(" ")}`
        : packageManager === "pnpm"
            ? `pnpm add ${depsWithVersions.join(" ")}`
            : `npm install ${depsWithVersions.join(" ")}`;
    console.log(`Installing dependencies with ${packageManager}...`);
    execSync(installCmd, { stdio: "inherit" });
}
async function checkProjectRequirements(requirements) {
    const installed = await getInstalledDependencies();
    const issues = [];
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
        const modulePackagePath = (0, node_path_1.join)(process.cwd(), "node_modules", ...name.split("/"), "package.json");
        if (!(0, fs_1.existsSync)(modulePackagePath)) {
            issues.push({
                name,
                required: requiredRange,
                declared: installedSpec,
                reason: "missing",
            });
            continue;
        }
        const resolvedVersion = (0, semver_1.minVersion)(installedSpec);
        const minimumRequired = (0, semver_1.minVersion)(requiredRange);
        const rangeSatisfied = resolvedVersion
            ? (0, semver_1.satisfies)(resolvedVersion, requiredRange, {
                includePrerelease: true,
            })
            : false;
        const higherVersionSatisfied = resolvedVersion && minimumRequired
            ? (0, semver_1.gte)(resolvedVersion, minimumRequired)
            : false;
        if (!resolvedVersion || (!rangeSatisfied && !higherVersionSatisfied)) {
            const normalizedVersion = resolvedVersion?.version;
            issues.push({
                name,
                required: requiredRange,
                installed: normalizedVersion,
                declared: normalizedVersion && normalizedVersion === installedSpec
                    ? undefined
                    : installedSpec,
                reason: resolvedVersion ? "outdated" : "unknown",
            });
        }
    }
    return issues;
}
