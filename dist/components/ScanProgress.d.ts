interface ScanProgressProps {
    agentName: string;
    targetPath: string;
    message: string;
    isComplete: boolean;
    issueCount?: number;
    costUsd?: number;
}
export declare function ScanProgress({ agentName, targetPath, message, isComplete, issueCount, costUsd }: ScanProgressProps): import("react/jsx-runtime").JSX.Element;
export {};
