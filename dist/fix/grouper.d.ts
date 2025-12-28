/**
 * Issue grouping logic for batch fixing.
 * Groups related issues into batches that can be fixed together in a single branch/PR.
 */
import type { ApprovedIssue } from '../types/index.js';
/**
 * A batch of issues to be fixed together.
 */
export interface IssueBatch {
    /** Unique identifier for this batch */
    id: string;
    /** Human-readable name for the batch (used as branch suffix) */
    name: string;
    /** Reason these issues are grouped together */
    reason: string;
    /** Issues in this batch */
    issues: ApprovedIssue[];
}
/**
 * Result of grouping issues into batches.
 */
export interface GroupingResult {
    /** Suggested batches of related issues */
    batches: IssueBatch[];
    /** Issues that don't fit into any batch (should be fixed individually) */
    individual: ApprovedIssue[];
}
/**
 * Group issues into batches for efficient fixing.
 *
 * Grouping heuristics (in priority order):
 * 1. Same directory - issues in the same module/area
 * 2. Same agent - same type of problem (similar fixes)
 * 3. Low severity - batch cleanup work
 * 4. Small scope - quick wins that can be done together
 *
 * @param issues - All approved issues to group
 * @param options - Grouping options
 * @returns Grouped batches and individual issues
 */
export declare function groupIssuesForBatching(issues: ApprovedIssue[], options?: {
    /** Minimum issues to form a batch (default: 2) */
    minBatchSize?: number;
    /** Maximum issues per batch (default: 10) */
    maxBatchSize?: number;
    /** Maximum estimated lines per batch (default: 200) */
    maxBatchScope?: number;
    /** Always batch low severity issues (default: true) */
    batchLowSeverity?: boolean;
}): GroupingResult;
/**
 * Format a batch for display in the CLI.
 */
export declare function formatBatchForDisplay(batch: IssueBatch, index: number): string;
/**
 * Get summary statistics for a grouping result.
 */
export declare function getGroupingStats(result: GroupingResult): {
    totalBatches: number;
    issuesInBatches: number;
    individualIssues: number;
    estimatedPRs: number;
};
