/**
 * Types for the rover fix workflow
 */
export interface FixOptions {
    targetPath: string;
    issueIds: string[];
    concurrency: number;
    maxIterations: number;
    verbose: boolean;
}
export interface FixFlags {
    concurrency: number;
    maxIterations: number;
    verbose: boolean;
}
export type FixStatus = 'success' | 'iteration_limit' | 'error' | 'already_fixed';
export interface FixResult {
    issueId: string;
    status: FixStatus;
    worktreePath: string;
    branchName: string;
    iterations: number;
    error?: string;
    durationMs: number;
}
export type FixPhase = 'pending' | 'worktree' | 'fixing' | 'reviewing' | 'iterating' | 'complete' | 'already_fixed' | 'error';
export interface FixProgress {
    issueId: string;
    phase: FixPhase;
    iteration: number;
    maxIterations: number;
    message: string;
    actionableItems?: number;
}
export interface IssueContext {
    id: string;
    content: string;
    ticketPath: string;
}
export interface ClaudeResult {
    sessionId: string;
    output: string;
    exitCode: number;
}
export interface ReviewItem {
    severity: 'must_fix' | 'should_fix' | 'suggestion';
    description: string;
    file?: string;
}
export interface ReviewAnalysis {
    isClean: boolean;
    items: ReviewItem[];
}
export interface ReviewTrace {
    architectureOutput: string;
    bugOutput: string;
    combinedOutput: string;
    parsedItems: ReviewItem[];
    actionableCount: number;
}
export interface IterationTrace {
    iteration: number;
    startedAt: string;
    completedAt: string;
    claudeSessionId?: string;
    claudeOutput: string;
    claudeExitCode: number;
    alreadyFixed: boolean;
    reviewNotApplicable: boolean;
    review?: ReviewTrace;
}
export interface FixTrace {
    issueId: string;
    startedAt: string;
    completedAt?: string;
    iterations: IterationTrace[];
    finalStatus: FixStatus;
    error?: string;
}
