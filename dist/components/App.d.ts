interface AppProps {
    command: string;
    targetPath: string;
    flags: {
        agent?: string;
        dryRun: boolean;
        verbose?: boolean;
    };
}
export declare function App({ command, targetPath, flags }: AppProps): import("react/jsx-runtime").JSX.Element;
export {};
