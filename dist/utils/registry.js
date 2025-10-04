import { readCacheText, writeCacheText } from "./cache.js";

const REGISTRY_BASE_URL = "https://nocta-ui.com/registry";
const REGISTRY_URL = `${REGISTRY_BASE_URL}/registry.json`;
const COMPONENTS_MANIFEST_PATH = "components.json";
const REGISTRY_TTL_MS = Number(
	process.env.NOCTA_CACHE_TTL_MS || 10 * 60 * 1000,
); // 10 min
const ASSET_TTL_MS = Number(
	process.env.NOCTA_ASSET_CACHE_TTL_MS || 24 * 60 * 60 * 1000,
); // 24 h
let componentsManifestPromise = null;
export async function getRegistry() {
	// Try network, cache on success; fallback to stale cache on failure
	try {
		const response = await fetch(REGISTRY_URL);
		if (!response.ok) {
			throw new Error(`Failed to fetch registry: ${response.statusText}`);
		}
		const text = await response.text();
		try {
			await writeCacheText("registry/registry.json", text);
		} catch {
			// non-fatal
		}
		return JSON.parse(text);
	} catch (error) {
		const cached = await readCacheText(
			"registry/registry.json",
			REGISTRY_TTL_MS,
			{ acceptStale: true },
		);
		if (cached) {
			try {
				return JSON.parse(cached);
			} catch {
				// fallthrough
			}
		}
		throw new Error(`Failed to load registry: ${error}`);
	}
}
export async function getComponent(name) {
	const registry = await getRegistry();
	const component = registry.components[name];
	if (!component) {
		throw new Error(`Component "${name}" not found`);
	}
	return component;
}
export async function getComponentFile(filePath) {
	const fileName = filePath.split("/").pop();
	if (!fileName) {
		throw new Error(`Invalid component file path: ${filePath}`);
	}
	try {
		const manifest = await getComponentsManifest();
		const encodedComponent = manifest[fileName];
		if (!encodedComponent) {
			throw new Error(
				`Component file "${fileName}" not found in registry manifest`,
			);
		}
		return Buffer.from(encodedComponent, "base64").toString("utf8");
	} catch (error) {
		throw new Error(`Failed to load component file: ${error}`);
	}
}
async function getComponentsManifest() {
	if (!componentsManifestPromise) {
		componentsManifestPromise = (async () => {
			const manifestContent = await getRegistryAsset(COMPONENTS_MANIFEST_PATH);
			try {
				return JSON.parse(manifestContent);
			} catch (error) {
				throw new Error(`Invalid components manifest JSON: ${error}`);
			}
		})();
	}
	return componentsManifestPromise;
}
export async function listComponents() {
	const registry = await getRegistry();
	return Object.values(registry.components);
}
export async function getRegistryAsset(assetPath) {
	const normalizedPath = assetPath.replace(/^\/+/, "");
	const url = `${REGISTRY_BASE_URL}/${normalizedPath}`;
	const cacheRel = `assets/${normalizedPath}`;
	try {
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(
				`Failed to fetch registry asset "${assetPath}": ${response.statusText}`,
			);
		}
		const text = await response.text();
		try {
			await writeCacheText(cacheRel, text);
		} catch {
			// non-fatal
		}
		return text;
	} catch (error) {
		const cached = await readCacheText(cacheRel, ASSET_TTL_MS, {
			acceptStale: true,
		});
		if (cached) return cached;
		throw new Error(`Failed to load registry asset "${assetPath}": ${error}`);
	}
}
export async function getComponentsByCategory(category) {
	const registry = await getRegistry();
	const components = Object.values(registry.components);
	if (!category) {
		return components;
	}
	return components.filter((component) => component.category === category);
}
export async function getCategories() {
	const registry = await getRegistry();
	return registry.categories;
}
export async function getComponentWithDependencies(name, visited = new Set()) {
	if (visited.has(name)) {
		return [];
	}
	visited.add(name);
	const component = await getComponent(name);
	const result = [component];
	if (
		component.internalDependencies &&
		component.internalDependencies.length > 0
	) {
		for (const depName of component.internalDependencies) {
			const depComponents = await getComponentWithDependencies(
				depName,
				visited,
			);
			result.unshift(...depComponents);
		}
	}
	const uniqueComponents = [];
	const seenNames = new Set();
	for (const comp of result) {
		if (!seenNames.has(comp.name)) {
			seenNames.add(comp.name);
			uniqueComponents.push(comp);
		}
	}
	return uniqueComponents;
}
