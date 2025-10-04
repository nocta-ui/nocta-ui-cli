import path from "path";
export function resolveComponentPath(componentFilePath, config) {
	const fileName = path.basename(componentFilePath);
	return path.join(config.aliases.components, fileName);
}
