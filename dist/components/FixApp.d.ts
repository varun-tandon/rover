interface FixAppProps {
    targetPath: string;
    issueIds: string[];
    flags: {
        concurrency: number;
        maxIterations: number;
        verbose: boolean;
    };
}
export declare function FixApp({ targetPath, issueIds, flags }: FixAppProps): import("react/jsx-runtime").JSX.Element;
export {};
