import path from "node:path";
import fs from "fs-extra";
export async function readConfig() {
    const configPath = path.join(process.cwd(), "nocta.config.json");
    if (!(await fs.pathExists(configPath))) {
        return null;
    }
    try {
        return await fs.readJson(configPath);
    }
    catch (error) {
        throw new Error(`Failed to read nocta.config.json: ${error}`);
    }
}
export async function writeConfig(config) {
    const configPath = path.join(process.cwd(), "nocta.config.json");
    const configWithSchema = {
        $schema: "https://nocta-ui.com/registry/config-schema.json",
        ...config,
    };
    configWithSchema.$schema = "https://nocta-ui.com/registry/config-schema.json";
    await fs.writeJson(configPath, configWithSchema, { spaces: 2 });
}
