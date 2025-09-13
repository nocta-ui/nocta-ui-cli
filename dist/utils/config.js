"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readConfig = readConfig;
exports.writeConfig = writeConfig;
const fs_extra_1 = __importDefault(require("fs-extra"));
const path_1 = __importDefault(require("path"));
async function readConfig() {
    const configPath = path_1.default.join(process.cwd(), 'nocta.config.json');
    if (!(await fs_extra_1.default.pathExists(configPath))) {
        return null;
    }
    try {
        return await fs_extra_1.default.readJson(configPath);
    }
    catch (error) {
        throw new Error(`Failed to read nocta.config.json: ${error}`);
    }
}
async function writeConfig(config) {
    const configPath = path_1.default.join(process.cwd(), 'nocta.config.json');
    await fs_extra_1.default.writeJson(configPath, config, { spaces: 2 });
}
