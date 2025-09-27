import path from "path";
import type { Config } from "../types";

export function resolveComponentPath(
	componentFilePath: string,
	config: Config,
): string {
	const fileName = path.basename(componentFilePath);
	return path.join(config.aliases.components, fileName);
}
