"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.init = init;
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const files_1 = require("../utils/files");
const fs_extra_1 = __importDefault(require("fs-extra"));
async function init() {
    const spinner = (0, ora_1.default)('Initializing nocta-ui...').start();
    try {
        const existingConfig = await (0, files_1.readConfig)();
        if (existingConfig) {
            spinner.stop();
            console.log(chalk_1.default.yellow('⚠️  components.json already exists!'));
            console.log(chalk_1.default.gray('Your project is already initialized.'));
            return;
        }
        const isNextJs = await fs_extra_1.default.pathExists('next.config.js') || await fs_extra_1.default.pathExists('next.config.mjs');
        const isVite = await fs_extra_1.default.pathExists('vite.config.js') || await fs_extra_1.default.pathExists('vite.config.ts');
        let isTailwindV4 = false;
        try {
            const packageJson = await fs_extra_1.default.readJson('package.json');
            const tailwindVersion = packageJson.dependencies?.tailwindcss || packageJson.devDependencies?.tailwindcss;
            if (tailwindVersion && (tailwindVersion.includes('^4') || tailwindVersion.includes('4.'))) {
                isTailwindV4 = true;
            }
        }
        catch {
        }
        let config;
        if (isNextJs) {
            config = {
                style: "default",
                tsx: true,
                tailwind: {
                    config: isTailwindV4 ? "" : "tailwind.config.js",
                    css: "app/globals.css"
                },
                aliases: {
                    components: "components",
                    utils: "lib/utils"
                }
            };
        }
        else if (isVite) {
            config = {
                style: "default",
                tsx: true,
                tailwind: {
                    config: isTailwindV4 ? "" : "tailwind.config.js",
                    css: "src/index.css"
                },
                aliases: {
                    components: "src/components",
                    utils: "src/lib/utils"
                }
            };
        }
        else {
            config = {
                style: "default",
                tsx: true,
                tailwind: {
                    config: isTailwindV4 ? "" : "tailwind.config.js",
                    css: "src/styles/globals.css"
                },
                aliases: {
                    components: "src/components",
                    utils: "src/lib/utils"
                }
            };
        }
        await (0, files_1.writeConfig)(config);
        spinner.succeed('nocta-ui initialized successfully!');
        console.log(chalk_1.default.green('\n✅ Configuration created:'));
        console.log(chalk_1.default.gray(`   components.json`));
        if (isTailwindV4) {
            console.log(chalk_1.default.blue('\n🎨 Tailwind v4 detected!'));
            console.log(chalk_1.default.gray('   Make sure your CSS file includes @import "tailwindcss";'));
        }
        console.log(chalk_1.default.blue('\n🚀 You can now add components:'));
        console.log(chalk_1.default.gray('   npx nocta-ui add button'));
    }
    catch (error) {
        spinner.fail('Failed to initialize nocta-ui');
        throw error;
    }
}
