#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const chalk_1 = __importDefault(require("chalk"));
const commander_1 = require("commander");
const add_1 = require("./commands/add");
const init_1 = require("./commands/init");
const list_1 = require("./commands/list");
const packageJson = require("../package.json");
const program = new commander_1.Command();
program
    .name("nocta-ui")
    .description("CLI for Nocta UI Components Library")
    .version(packageJson.version);
program
    .command("init")
    .description("Initialize your project with components config")
    .action(async () => {
    try {
        await (0, init_1.init)();
    }
    catch (error) {
        console.error(chalk_1.default.red("Error:", error));
        process.exit(1);
    }
});
program
    .command("add")
    .description("Add components to your project")
    .argument("<components...>", "component names")
    .action(async (componentNames) => {
    try {
        await (0, add_1.add)(componentNames);
    }
    catch (error) {
        console.error(chalk_1.default.red("Error:", error));
        process.exit(1);
    }
});
program
    .command("list")
    .description("List all available components")
    .action(async () => {
    try {
        await (0, list_1.list)();
    }
    catch (error) {
        console.error(chalk_1.default.red("Error:", error));
        process.exit(1);
    }
});
program.on("command:*", () => {
    console.error(chalk_1.default.red("Invalid command: %s"), program.args.join(" "));
    console.log(chalk_1.default.yellow("See --help for a list of available commands."));
    process.exit(1);
});
program.parse();
