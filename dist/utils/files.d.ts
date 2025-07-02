import { Config } from '../types';
export declare function readConfig(): Promise<Config | null>;
export declare function writeConfig(config: Config): Promise<void>;
export declare function fileExists(filePath: string): Promise<boolean>;
export declare function writeComponentFile(filePath: string, content: string): Promise<void>;
export declare function resolveComponentPath(componentFilePath: string, config: Config): string;
export declare function installDependencies(dependencies: Record<string, string>): Promise<void>;
export declare function addDesignTokensToCss(cssFilePath: string): Promise<boolean>;
export declare function addDesignTokensToTailwindConfig(configFilePath: string): Promise<boolean>;
export declare function checkTailwindInstallation(): Promise<{
    installed: boolean;
    version?: string;
}>;
export declare function isTypeScriptProject(): Promise<boolean>;
export declare function getTailwindConfigPath(): Promise<string>;
export declare function rollbackInitChanges(): Promise<void>;
export interface FrameworkDetection {
    framework: 'nextjs' | 'vite-react' | 'unknown';
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
