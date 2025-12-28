import type { IssueStore, ApprovedIssue, IssueSummary, IssueSeverity } from '../types/index.js';
export declare function getRoverDir(targetPath: string): string;
export declare function getIssuesPath(targetPath: string): string;
export declare function ensureRoverDir(targetPath: string): Promise<void>;
export declare function loadIssueStore(targetPath: string): Promise<IssueStore>;
export declare function saveIssueStore(targetPath: string, store: IssueStore): Promise<void>;
export declare function addApprovedIssues(targetPath: string, issues: ApprovedIssue[]): Promise<IssueStore>;
export declare function getExistingIssueSummaries(targetPath: string): Promise<IssueSummary[]>;
export declare function isDuplicateIssue(targetPath: string, title: string, filePath: string, category: string): Promise<boolean>;
export declare function getIssueStats(targetPath: string): Promise<{
    totalIssues: number;
    byCategory: Partial<Record<string, number>>;
    bySeverity: Partial<Record<IssueSeverity, number>>;
    lastScanAt: string | null;
}>;
/**
 * Use an LLM to create a condensed summary of existing issues for deduplication.
 * Groups similar issues and creates short fingerprints that scanners can check against.
 *
 * For small issue counts (<= 5), formats directly without LLM.
 * For larger sets, uses Claude to intelligently compress and group issues.
 *
 * @param targetPath - Path to the target directory containing .rover/issues.json
 * @returns Formatted summary string of existing issues for scanner context
 * @throws Error if ANTHROPIC_API_KEY is not set when LLM summarization is needed
 * @requires ANTHROPIC_API_KEY environment variable must be set for issue counts > 5
 */
export declare function summarizeExistingIssues(targetPath: string): Promise<string>;
/**
 * Result of removing issues
 */
export interface RemoveIssuesResult {
    removed: string[];
    notFound: string[];
    errors: Array<{
        ticketId: string;
        error: string;
    }>;
}
/**
 * Result of ignoring issues (marking as "won't fix")
 */
export interface IgnoreIssuesResult {
    ignored: string[];
    notFound: string[];
    errors: Array<{
        ticketId: string;
        error: string;
    }>;
}
/**
 * Select the top priority issues from a list.
 * Priority is calculated as: severityWeight * 10 + approvalVotes
 *
 * @param issues - Issues to select from
 * @param count - Number of issues to select (default: 10)
 * @returns Top priority issues sorted by priority descending
 */
export declare function selectTopPriorityIssues(issues: ApprovedIssue[], count?: number): ApprovedIssue[];
/**
 * Consolidate multiple issues into a single issue.
 * Atomically removes the original issues and adds the consolidated one.
 *
 * @param targetPath - Path to the target directory
 * @param originalIds - Ticket IDs of issues to remove (e.g., "ISSUE-001")
 * @param consolidated - The new consolidated issue to add
 * @returns Updated issue store
 */
export declare function consolidateIssues(targetPath: string, originalIds: string[], consolidated: ApprovedIssue): Promise<IssueStore>;
/**
 * Remove issues by their ticket IDs (e.g., "ISSUE-001", "ISSUE-002")
 * Removes from both issues.json and deletes ticket files
 */
export declare function removeIssues(targetPath: string, ticketIds: string[]): Promise<RemoveIssuesResult>;
/**
 * Mark issues as "won't fix" by their ticket IDs (e.g., "ISSUE-001", "ISSUE-002")
 * Issues remain in the store (for deduplication) but are hidden from the default list
 */
export declare function ignoreIssues(targetPath: string, ticketIds: string[]): Promise<IgnoreIssuesResult>;
