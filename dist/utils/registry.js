"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRegistry = getRegistry;
exports.getComponent = getComponent;
exports.getComponentFile = getComponentFile;
exports.listComponents = listComponents;
exports.getComponentsByCategory = getComponentsByCategory;
exports.getCategories = getCategories;
const REGISTRY_URL = 'https://raw.githubusercontent.com/66HEX/nocta-ui/main/registry.json';
const COMPONENTS_BASE_URL = 'https://raw.githubusercontent.com/66HEX/nocta-ui/main';
async function getRegistry() {
    try {
        const response = await fetch(REGISTRY_URL);
        if (!response.ok) {
            throw new Error(`Failed to fetch registry: ${response.statusText}`);
        }
        return await response.json();
    }
    catch (error) {
        throw new Error(`Failed to load registry: ${error}`);
    }
}
async function getComponent(name) {
    const registry = await getRegistry();
    const component = registry.components[name];
    if (!component) {
        throw new Error(`Component "${name}" not found`);
    }
    return component;
}
async function getComponentFile(filePath) {
    try {
        const response = await fetch(`${COMPONENTS_BASE_URL}/${filePath}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch component file: ${response.statusText}`);
        }
        return await response.text();
    }
    catch (error) {
        throw new Error(`Failed to load component file: ${error}`);
    }
}
async function listComponents() {
    const registry = await getRegistry();
    return Object.values(registry.components);
}
async function getComponentsByCategory(category) {
    const registry = await getRegistry();
    const components = Object.values(registry.components);
    if (!category) {
        return components;
    }
    return components.filter(component => component.category === category);
}
async function getCategories() {
    const registry = await getRegistry();
    return registry.categories;
}
