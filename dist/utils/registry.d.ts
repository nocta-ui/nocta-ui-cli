import { Registry, Component } from '../types';
export declare function getRegistry(): Promise<Registry>;
export declare function getComponent(name: string): Promise<Component>;
export declare function getComponentFile(filePath: string): Promise<string>;
export declare function listComponents(): Promise<Component[]>;
export declare function getComponentsByCategory(category?: string): Promise<Component[]>;
export declare function getCategories(): Promise<Record<string, {
    name: string;
    description: string;
    components: string[];
}>>;
export declare function getComponentWithDependencies(name: string, visited?: Set<string>): Promise<Component[]>;
