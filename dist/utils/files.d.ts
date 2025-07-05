import { Config, Theme } from '../types';
export declare function getInstalledDependencies(): Promise<Record<string, string>>;
export declare function readConfig(): Promise<Config | null>;
export declare function writeConfig(config: Config): Promise<void>;
export declare function fileExists(filePath: string): Promise<boolean>;
export declare function writeComponentFile(filePath: string, content: string): Promise<void>;
export declare function resolveComponentPath(componentFilePath: string, config: Config): string;
export declare function installDependencies(dependencies: Record<string, string>): Promise<void>;
export declare function addDesignTokensToCss(cssFilePath: string, themeName?: string): Promise<boolean>;
export declare function addDesignTokensToTailwindConfig(configFilePath: string, themeName?: string): Promise<boolean>;
export declare function checkTailwindInstallation(): Promise<{
    installed: boolean;
    version?: string;
}>;
export declare function isTypeScriptProject(): Promise<boolean>;
export declare function getTailwindConfigPath(): Promise<string>;
export declare function rollbackInitChanges(): Promise<void>;
export interface FrameworkDetection {
    framework: 'nextjs' | 'vite-react' | 'react-router' | 'unknown';
    version?: string;
    details: {
        hasConfig: boolean;
        hasReactDependency: boolean;
        hasFrameworkDependency: boolean;
        appStructure?: 'app-router' | 'pages-router' | 'unknown';
        configFiles: string[];
    };
}
export declare function detectFramework(): Promise<FrameworkDetection>;
export declare function getThemeByName(themeName: string): Theme;
export declare function generateDesignTokensCss(theme: Theme): string;
export declare function generateTailwindV3Colors(theme: Theme): Record<string, Record<string, string>>;
export declare function generateTailwindV3ColorsString(theme: Theme): string;
