"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readConfig = readConfig;
exports.writeConfig = writeConfig;
exports.writeComponentFile = writeComponentFile;
exports.resolveComponentPath = resolveComponentPath;
exports.installDependencies = installDependencies;
const fs_extra_1 = __importDefault(require("fs-extra"));
const path_1 = __importDefault(require("path"));
async function readConfig() {
    const configPath = path_1.default.join(process.cwd(), 'components.json');
    if (!(await fs_extra_1.default.pathExists(configPath))) {
        return null;
    }
    try {
        return await fs_extra_1.default.readJson(configPath);
    }
    catch (error) {
        throw new Error(`Failed to read components.json: ${error}`);
    }
}
async function writeConfig(config) {
    const configPath = path_1.default.join(process.cwd(), 'components.json');
    await fs_extra_1.default.writeJson(configPath, config, { spaces: 2 });
}
async function writeComponentFile(filePath, content) {
    const fullPath = path_1.default.join(process.cwd(), filePath);
    await fs_extra_1.default.ensureDir(path_1.default.dirname(fullPath));
    await fs_extra_1.default.writeFile(fullPath, content, 'utf8');
}
function resolveComponentPath(componentFilePath, config) {
    // Usuń całą ścieżkę do pliku i zostaw tylko nazwę pliku
    const fileName = path_1.default.basename(componentFilePath);
    // Wyciągnij folder komponentu z ścieżki (np. z "app/components/ui/button/button.tsx" -> "button")
    const componentFolder = path_1.default.basename(path_1.default.dirname(componentFilePath));
    // Utwórz docelową ścieżkę: components/ui/button.tsx
    return path_1.default.join(config.aliases.components, 'ui', fileName);
}
async function installDependencies(dependencies) {
    const deps = Object.keys(dependencies);
    if (deps.length === 0)
        return;
    const { execSync } = require('child_process');
    // Sprawdź który package manager jest używany
    let packageManager = 'npm';
    if (await fs_extra_1.default.pathExists('yarn.lock')) {
        packageManager = 'yarn';
    }
    else if (await fs_extra_1.default.pathExists('pnpm-lock.yaml')) {
        packageManager = 'pnpm';
    }
    const installCmd = packageManager === 'yarn'
        ? `yarn add ${deps.join(' ')}`
        : packageManager === 'pnpm'
            ? `pnpm add ${deps.join(' ')}`
            : `npm install ${deps.join(' ')}`;
    console.log(`Installing dependencies with ${packageManager}...`);
    execSync(installCmd, { stdio: 'inherit' });
}
