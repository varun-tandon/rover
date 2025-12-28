import type { ArbitratorResult, ArbitratorOptions } from './types.js';
/**
 * Save approved issues and create tickets.
 *
 * The arbitrator performs the final stage of the scan pipeline:
 * 1. Filters candidate issues to only those approved by the checker
 * 2. Creates markdown ticket files for approved issues (organized by severity)
 * 3. Persists approved issues to the issue store for deduplication
 *
 * @param options - Configuration for arbitration
 * @param options.targetPath - Absolute path to the codebase (for ticket storage in .rover/)
 * @param options.candidateIssues - All candidate issues detected by the scanner
 * @param options.approvedIds - IDs of issues approved by the checker
 * @returns Arbitration results including approved/rejected issues and created ticket paths
 */
export declare function runArbitrator(options: ArbitratorOptions): Promise<ArbitratorResult>;
export declare function getArbitrationSummary(result: ArbitratorResult): string;
