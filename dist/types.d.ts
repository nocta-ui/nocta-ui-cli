export interface ComponentFile {
    name: string;
    path: string;
    type: string;
}
export interface ComponentFileWithContent extends ComponentFile {
    content: string;
    componentName: string;
}
export interface Component {
    name: string;
    description: string;
    category: string;
    files: ComponentFile[];
    dependencies: Record<string, string>;
    internalDependencies?: string[];
    exports: string[];
    props?: Record<string, string[]>;
    variants?: string[];
    sizes?: string[];
    features: string[];
}
export interface Registry {
    name: string;
    description: string;
    version: string;
    components: Record<string, Component>;
    categories: Record<string, {
        name: string;
        description: string;
        components: string[];
    }>;
    features: string[];
    requirements: Record<string, string>;
}
export interface Config {
    style: string;
    tsx: boolean;
    theme: string;
    tailwind: {
        config: string;
        css: string;
    };
    aliases: {
        components: string;
        utils: string;
    };
}
export interface ThemeColors {
    [key: string]: string;
}
export interface Theme {
    name: string;
    displayName: string;
    description: string;
    colors: ThemeColors;
}
export declare const AVAILABLE_THEMES: Theme[];
