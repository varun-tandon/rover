interface ConsolidateAppProps {
    targetPath: string;
    flags: {
        dryRun: boolean;
        verbose?: boolean;
        concurrency?: number;
    };
}
export declare function ConsolidateApp({ targetPath, flags }: ConsolidateAppProps): import("react/jsx-runtime").JSX.Element;
export {};
