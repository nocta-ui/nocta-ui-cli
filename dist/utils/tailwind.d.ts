export declare function addDesignTokensToCss(cssFilePath: string): Promise<boolean>;
export declare function checkTailwindInstallation(): Promise<{
    installed: boolean;
    version?: string;
}>;
