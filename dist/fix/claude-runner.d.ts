/**
 * Claude CLI interaction for the fix workflow
 */
import type { ClaudeResult } from './types.js';
interface ClaudeOptions {
    prompt: string;
    cwd: string;
    sessionId?: string;
    model?: 'sonnet' | 'opus' | 'haiku';
    onProgress?: (message: string) => void;
    verbose?: boolean;
}
/**
 * Run the Claude CLI with the given options
 */
export declare function runClaude(options: ClaudeOptions): Promise<ClaudeResult>;
/**
 * Check if Claude output indicates the issue is already fixed
 */
export declare function isAlreadyFixed(output: string): boolean;
/**
 * Check if Claude output indicates the review feedback was not applicable
 * (false positive, wrong codebase, etc.)
 */
export declare function isReviewNotApplicable(output: string): boolean;
/**
 * Extract Claude's justification for marking review as not applicable.
 * Parses stream-json output to get all text content.
 */
export declare function extractDismissalJustification(output: string): string;
/**
 * Build the initial fix prompt for an issue
 */
export declare function buildInitialFixPrompt(issueId: string, issueContent: string): string;
/**
 * Build the iteration prompt for addressing review feedback
 */
export declare function buildIterationPrompt(issueId: string, actionableItems: Array<{
    severity: string;
    description: string;
    file?: string;
}>): string;
export {};
