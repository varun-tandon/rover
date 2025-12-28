interface BatchAppProps {
    targetPath: string;
    flags: {
        all?: boolean;
        agent?: string;
        concurrency?: number;
        dryRun: boolean;
        resume?: boolean;
    };
}
export declare function BatchApp({ targetPath, flags }: BatchAppProps): import("react/jsx-runtime").JSX.Element;
export {};
