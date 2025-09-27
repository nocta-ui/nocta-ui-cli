"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readConfig = readConfig;
exports.writeConfig = writeConfig;
const node_path_1 = __importDefault(require("node:path"));
const fs_extra_1 = __importDefault(require("fs-extra"));
async function readConfig() {
    const configPath = node_path_1.default.join(process.cwd(), "nocta.config.json");
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
    const configPath = node_path_1.default.join(process.cwd(), "nocta.config.json");
    const configWithSchema = {
        $schema: "http://nocta-ui.com/registry/config-schema.json",
        ...config,
    };
    configWithSchema.$schema = "http://nocta-ui.com/registry/config-schema.json";
    await fs_extra_1.default.writeJson(configPath, configWithSchema, { spaces: 2 });
}
