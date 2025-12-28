/**
 * Review manager for listing completed fixes and creating PRs
 */
import { type FixRecord } from '../storage/fix-state.js';
export interface ReviewListResult {
    fixes: FixRecord[];
    totalCount: number;
    readyCount: number;
    prCreatedCount: number;
    errorCount: number;
}
export interface PRCreateResult {
    success: boolean;
    issueId: string;
    prUrl?: string;
    prNumber?: number;
    error?: string;
}
/**
 * List all fixes with their current status
 */
export declare function listFixes(targetPath: string): Promise<ReviewListResult>;
/**
 * Get detailed info about a specific fix
 */
export declare function getFixDetails(targetPath: string, issueId: string): Promise<{
    fix: FixRecord | null;
    commitSummary: string;
    defaultBranch: string;
}>;
/**
 * Create a PR for a fix using gh CLI
 */
export declare function createPR(targetPath: string, issueId: string, options?: {
    title?: string;
    body?: string;
    draft?: boolean;
    onLog?: (message: string) => void;
}): Promise<PRCreateResult>;
/**
 * Create PRs for all fixes ready for review
 */
export declare function createAllPRs(targetPath: string, options?: {
    draft?: boolean;
    onProgress?: (issueId: string, result: PRCreateResult) => void;
    onLog?: (message: string) => void;
}): Promise<PRCreateResult[]>;
/**
 * Clean up a fix (remove worktree and record)
 */
export declare function cleanupFix(targetPath: string, issueId: string): Promise<{
    success: boolean;
    error?: string;
}>;
export interface CleanupResult {
    success: boolean;
    issueId: string;
    error?: string;
}
/**
 * Clean up all fixes (remove worktrees and records)
 */
export declare function cleanupAllFixes(targetPath: string, options?: {
    onProgress?: (issueId: string, result: CleanupResult) => void;
    onLog?: (message: string) => void;
}): Promise<CleanupResult[]>;
