export interface RequirementIssue {
	name: string;
	required: string;
	installed?: string;
	declared?: string;
	reason: "missing" | "outdated" | "unknown";
}
export declare function getInstalledDependencies(): Promise<
	Record<string, string>
>;
export declare function installDependencies(
	dependencies: Record<string, string>,
): Promise<void>;
export declare function checkProjectRequirements(
	requirements: Record<string, string>,
): Promise<RequirementIssue[]>;
