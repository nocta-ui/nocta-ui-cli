import { Config } from '../types';
export declare function readConfig(): Promise<Config | null>;
export declare function writeConfig(config: Config): Promise<void>;
export declare function writeComponentFile(filePath: string, content: string): Promise<void>;
export declare function resolveComponentPath(componentFilePath: string, config: Config): string;
export declare function installDependencies(dependencies: Record<string, string>): Promise<void>;
