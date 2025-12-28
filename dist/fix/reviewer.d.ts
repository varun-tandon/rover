/**
 * Code review execution and parsing for the fix workflow
 */
import type { ReviewItem, ReviewAnalysis } from './types.js';
interface ReviewOptions {
    onProgress?: (message: string) => void;
    verbose?: boolean;
    issueContent?: string;
}
interface FullReviewResult {
    architectureReview: string;
    bugReview: string;
    completenessReview: string;
    combined: string;
}
/**
 * Run architecture-focused code review (backwards compatible)
 * The reviewer only has read-only access to the codebase (Read, Glob, Grep, LS)
 */
export declare function runReview(worktreePath: string, options?: ReviewOptions): Promise<string>;
/**
 * Run bug-focused code review
 * Checks for implementation errors, runtime bugs, and common mistakes
 */
export declare function runBugReview(worktreePath: string, options?: ReviewOptions): Promise<string>;
/**
 * Run completeness review
 * Verifies that ALL items from the original issue have been addressed
 * Requires issueContent to be provided
 */
export declare function runCompletenessReview(worktreePath: string, options: ReviewOptions & {
    issueContent: string;
}): Promise<string>;
/**
 * Run architecture, bug, and completeness reviews
 * All reviews must pass for the fix to be considered complete
 * Completeness review only runs if issueContent is provided
 */
export declare function runFullReview(worktreePath: string, options?: ReviewOptions): Promise<FullReviewResult>;
/**
 * Parse review output to extract actionable items using Claude SDK
 */
export declare function parseReviewForActionables(reviewOutput: string): Promise<ReviewAnalysis>;
/**
 * Check if a review has actionable items that require another iteration
 */
export declare function hasActionableItems(analysis: ReviewAnalysis): boolean;
/**
 * Verify that Claude's dismissal of review findings is legitimate.
 * Uses a skeptical reviewer to check each must_fix item.
 */
export declare function verifyReviewDismissal(mustFixItems: ReviewItem[], claudeJustification: string, _worktreePath: string, options?: {
    onProgress?: (msg: string) => void;
}): Promise<{
    allVerified: boolean;
    remainingItems: ReviewItem[];
}>;
export {};
