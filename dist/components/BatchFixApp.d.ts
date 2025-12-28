interface BatchFixAppProps {
    targetPath: string;
    issueIds: string[];
    flags: {
        maxIterations: number;
        verbose: boolean;
    };
}
export declare function BatchFixApp({ targetPath, issueIds, flags }: BatchFixAppProps): import("react/jsx-runtime").JSX.Element;
export {};
