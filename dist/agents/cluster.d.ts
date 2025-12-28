/**
 * Issue clustering logic for consolidation.
 * Groups related issues by file path, category, and title similarity
 * without using any LLM calls.
 */
import type { ApprovedIssue, IssueCluster } from '../types/index.js';
/**
 * Cluster issues by multiple criteria:
 * 1. Same file path AND same category (strongest signal)
 * 2. Same file path (different categories)
 * 3. Title similarity above threshold (for remaining unclustered issues)
 *
 * Only returns clusters with 2+ issues.
 */
export declare function clusterIssues(issues: ApprovedIssue[]): IssueCluster[];
/**
 * Get statistics about clustering results.
 */
export declare function getClusterStats(clusters: IssueCluster[]): {
    totalClusters: number;
    totalIssuesInClusters: number;
    avgClusterSize: number;
    largestCluster: number;
};
