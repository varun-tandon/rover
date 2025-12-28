/**
 * Consolidator agent for merging related issues into a single comprehensive issue.
 * Uses an LLM to analyze the issues and produce a merged version.
 */
import type { ApprovedIssue, IssueCluster } from '../types/index.js';
/**
 * Options for running the consolidator
 */
export interface ConsolidatorOptions {
    /** Target directory containing the code */
    targetPath: string;
    /** Cluster of issues to consolidate */
    cluster: IssueCluster;
    /** Callback for progress updates */
    onProgress?: (message: string) => void;
}
/**
 * Result from the consolidator
 */
export interface ConsolidatorResult {
    /** The merged issue (without ticketPath, to be set later) */
    consolidatedIssue: Omit<ApprovedIssue, 'ticketPath'>;
    /** Original issue IDs that were consolidated */
    originalIssueIds: string[];
    /** Duration in milliseconds */
    durationMs: number;
}
/**
 * Run the consolidator agent to merge a cluster of related issues.
 */
export declare function runConsolidator(options: ConsolidatorOptions): Promise<ConsolidatorResult>;
