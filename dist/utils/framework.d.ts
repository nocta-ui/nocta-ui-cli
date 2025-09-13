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
export declare function isTypeScriptProject(): Promise<boolean>;
export declare function detectFramework(): Promise<FrameworkDetection>;
