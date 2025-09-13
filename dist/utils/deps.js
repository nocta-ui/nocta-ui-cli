"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getInstalledDependencies = getInstalledDependencies;
exports.installDependencies = installDependencies;
const fs_1 = require("fs");
const fs_extra_1 = __importDefault(require("fs-extra"));
const path_1 = require("path");
async function getInstalledDependencies() {
    try {
        const packageJsonPath = (0, path_1.join)(process.cwd(), "package.json");
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
                const nodeModulesPath = (0, path_1.join)(process.cwd(), "node_modules", depName, "package.json");
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
    const installCmd = packageManager === "yarn"
        ? `yarn add ${deps.join(" ")}`
        : packageManager === "pnpm"
            ? `pnpm add ${deps.join(" ")}`
            : `npm install ${deps.join(" ")}`;
    console.log(`Installing dependencies with ${packageManager}...`);
    execSync(installCmd, { stdio: "inherit" });
}
