import type { Config } from "../types.js";
export declare function readConfig(): Promise<Config | null>;
export declare function writeConfig(config: Config): Promise<void>;
