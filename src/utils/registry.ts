import type { Component, Registry } from "../types";

const REGISTRY_BASE_URL = "https://nocta-ui.com/registry";
const REGISTRY_URL = `${REGISTRY_BASE_URL}/registry.json`;
const COMPONENTS_BASE_URL =
	"https://raw.githubusercontent.com/66HEX/nocta-ui/main";

export async function getRegistry(): Promise<Registry> {
	try {
		const response = await fetch(REGISTRY_URL);
		if (!response.ok) {
			throw new Error(`Failed to fetch registry: ${response.statusText}`);
		}
		return (await response.json()) as Registry;
	} catch (error) {
		throw new Error(`Failed to load registry: ${error}`);
	}
}

export async function getComponent(name: string): Promise<Component> {
	const registry = await getRegistry();
	const component = registry.components[name];

	if (!component) {
		throw new Error(`Component "${name}" not found`);
	}

	return component;
}

export async function getComponentFile(filePath: string): Promise<string> {
	try {
		const response = await fetch(`${COMPONENTS_BASE_URL}/${filePath}`);
		if (!response.ok) {
			throw new Error(`Failed to fetch component file: ${response.statusText}`);
		}
		return await response.text();
	} catch (error) {
		throw new Error(`Failed to load component file: ${error}`);
	}
}

export async function listComponents(): Promise<Component[]> {
	const registry = await getRegistry();
	return Object.values(registry.components);
}

export async function getRegistryAsset(assetPath: string): Promise<string> {
	const normalizedPath = assetPath.replace(/^\/+/, "");
	try {
		const response = await fetch(`${REGISTRY_BASE_URL}/${normalizedPath}`);
		if (!response.ok) {
			throw new Error(
				`Failed to fetch registry asset "${assetPath}": ${response.statusText}`,
			);
		}
		return await response.text();
	} catch (error) {
		throw new Error(`Failed to load registry asset "${assetPath}": ${error}`);
	}
}

export async function getComponentsByCategory(
	category?: string,
): Promise<Component[]> {
	const registry = await getRegistry();
	const components = Object.values(registry.components);

	if (!category) {
		return components;
	}

	return components.filter((component) => component.category === category);
}

export async function getCategories(): Promise<
	Record<string, { name: string; description: string; components: string[] }>
> {
	const registry = await getRegistry();
	return registry.categories;
}

export async function getComponentWithDependencies(
	name: string,
	visited: Set<string> = new Set(),
): Promise<Component[]> {
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
	const seenNames = new Set<string>();

	for (const comp of result) {
		if (!seenNames.has(comp.name)) {
			seenNames.add(comp.name);
			uniqueComponents.push(comp);
		}
	}

	return uniqueComponents;
}
