import type { ApprovedIssue, CandidateIssue } from '../types/index.js';
interface ResultsProps {
    approvedIssues: ApprovedIssue[];
    rejectedIssues: CandidateIssue[];
    ticketPaths: string[];
    durationMs: number;
    totalCost: number;
}
export declare function Results({ approvedIssues, rejectedIssues, ticketPaths, durationMs, totalCost }: ResultsProps): import("react/jsx-runtime").JSX.Element;
export {};
