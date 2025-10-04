#!/usr/bin/env node
import fs from "node:fs";
import chalk from "chalk";
import { Command } from "commander";
import { add } from "./commands/add.js";
import { init } from "./commands/init.js";
import { list } from "./commands/list.js";

// Read package.json in ESM context
const packageJsonUrl = new URL("../package.json", import.meta.url);
const packageJson = JSON.parse(fs.readFileSync(packageJsonUrl, "utf8"));

const program = new Command();

program
	.name("nocta-ui")
	.description("CLI for Nocta UI Components Library")
	.version(packageJson.version);

program
    .command("init")
    .description("Initialize your project with components config")
    .option("--dry-run", "Preview actions without writing or installing")
    .action(async (options: { dryRun?: boolean }) => {
        try {
            await init({ dryRun: Boolean(options?.dryRun) });
        } catch (error) {
            console.error(chalk.red("Error:", error));
            process.exit(1);
        }
    });

program
    .command("add")
    .description("Add components to your project")
    .argument("<components...>", "component names")
    .option("--dry-run", "Preview actions without writing or installing")
    .action(async (componentNames: string[], options: { dryRun?: boolean }) => {
        try {
            await add(componentNames, { dryRun: Boolean(options?.dryRun) });
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
