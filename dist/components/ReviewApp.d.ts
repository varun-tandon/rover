type ReviewSubcommand = 'list' | 'submit' | 'clean';
interface ReviewAppProps {
    targetPath: string;
    subcommand: ReviewSubcommand;
    issueId?: string;
    flags: {
        draft?: boolean;
        all?: boolean;
    };
}
export declare function ReviewApp({ targetPath, subcommand, issueId, flags }: ReviewAppProps): import("react/jsx-runtime").JSX.Element;
export {};
