import type { VoterStatus } from '../types/index.js';
interface VotingProgressProps {
    issueCount: number;
    voters: VoterStatus[];
    isComplete: boolean;
}
export declare function VotingProgress({ issueCount, voters, isComplete }: VotingProgressProps): import("react/jsx-runtime").JSX.Element;
export {};
