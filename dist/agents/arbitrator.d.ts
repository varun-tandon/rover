import type { ArbitratorResult, ArbitratorOptions } from './types.js';
/**
 * Run the arbitrator to filter issues by vote count and create tickets.
 *
 * The arbitrator performs the final stage of the scan pipeline:
 * 1. Collects all votes for each candidate issue
 * 2. Filters to only issues with sufficient approval votes (default: 2/3 majority)
 * 3. Creates markdown ticket files for approved issues (organized by severity)
 * 4. Persists approved issues to the issue store for deduplication
 *
 * @param options - Configuration for arbitration
 * @param options.targetPath - Absolute path to the codebase (for ticket storage in .rover/)
 * @param options.candidateIssues - All candidate issues detected by the scanner
 * @param options.votes - All votes from all voters on the candidate issues
 * @param options.minimumVotes - Minimum approval votes required (default: 2 for 3 voters)
 * @returns Arbitration results including approved/rejected issues and created ticket paths
 */
export declare function runArbitrator(options: ArbitratorOptions): Promise<ArbitratorResult>;
export declare function getArbitrationSummary(result: ArbitratorResult): string;
