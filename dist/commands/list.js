"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.list = list;
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const utils_1 = require("../utils");
async function list() {
    const spinner = (0, ora_1.default)("Fetching components...").start();
    try {
        const [components, categories] = await Promise.all([
            (0, utils_1.listComponents)(),
            (0, utils_1.getCategories)(),
        ]);
        spinner.stop();
        console.log(chalk_1.default.blue.bold("\nAvailable nocta-ui components:\n"));
        Object.entries(categories).forEach(([categoryKey, category]) => {
            console.log(chalk_1.default.yellow.bold(`${category.name}:`));
            console.log(chalk_1.default.gray(`  ${category.description}\n`));
            const categoryComponents = components.filter((comp) => comp.category === categoryKey);
            categoryComponents.forEach((component) => {
                console.log(chalk_1.default.green(`  ${component.name.toLowerCase()}`));
                console.log(chalk_1.default.gray(`    ${component.description}`));
                if (component.variants && component.variants.length > 0) {
                    console.log(chalk_1.default.blue(`  Variants: ${component.variants.join(", ")}`));
                }
                if (component.sizes && component.sizes.length > 0) {
                    console.log(chalk_1.default.blue(`  Sizes: ${component.sizes.join(", ")}`));
                }
                console.log();
            });
        });
        console.log(chalk_1.default.blue("\nAdd a component:"));
        console.log(chalk_1.default.gray("  npx nocta-ui add <component-name>"));
        console.log(chalk_1.default.blue("\nExamples:"));
        console.log(chalk_1.default.gray("  npx nocta-ui add button"));
        console.log(chalk_1.default.gray("  npx nocta-ui add card"));
    }
    catch (error) {
        spinner.fail("Failed to fetch components");
        throw error;
    }
}
