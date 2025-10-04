import path from "node:path";
import type { Config } from "../types.js";

export function resolveComponentPath(
	componentFilePath: string,
	config: Config,
): string {
	const fileName = path.basename(componentFilePath);
	return path.join(config.aliases.components, fileName);
}
