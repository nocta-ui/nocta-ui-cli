#!/usr/bin/env node
import chalk from "chalk";
import { Command } from "commander";
import { add } from "./commands/add";
import { init } from "./commands/init";
import { list } from "./commands/list";

const packageJson = require("../package.json");

const program = new Command();

program
	.name("nocta-ui")
	.description("CLI for Nocta UI Components Library")
	.version(packageJson.version);

program
	.command("init")
	.description("Initialize your project with components config")
	.action(async () => {
		try {
			await init();
		} catch (error) {
			console.error(chalk.red("Error:", error));
			process.exit(1);
		}
	});

program
	.command("add")
	.description("Add components to your project")
	.argument("<components...>", "component names")
	.action(async (componentNames: string[]) => {
		try {
			await add(componentNames);
		} catch (error) {
			console.error(chalk.red("Error:", error));
			process.exit(1);
		}
	});

program
	.command("list")
	.description("List all available components")
	.action(async () => {
		try {
			await list();
		} catch (error) {
			console.error(chalk.red("Error:", error));
			process.exit(1);
		}
	});

program.on("command:*", () => {
	console.error(chalk.red("Invalid command: %s"), program.args.join(" "));
	console.log(chalk.yellow("See --help for a list of available commands."));
	process.exit(1);
});

program.parse();
