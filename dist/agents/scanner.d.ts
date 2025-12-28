import type { ScannerResult, ScannerOptions } from './types.js';
/**
 * Run the scanner agent to detect issues in the codebase.
 *
 * Uses an AI agent to explore the codebase according to agent-specific guidelines,
 * identifying code quality issues, architectural problems, and potential improvements.
 *
 * @param options - Configuration for the scan
 * @param options.targetPath - Absolute path to the directory to scan
 * @param options.agentId - ID of the agent definition to use (determines scan focus)
 * @param options.existingIssues - Summaries of previously detected issues for deduplication
 * @param options.onProgress - Optional callback for real-time progress updates
 * @returns Scan results including detected issues, timing, and cost information
 * @throws Error if the specified agent ID is not found
 * @throws Error if the underlying AI query fails (network issues, API errors)
 */
export declare function runScanner(options: ScannerOptions): Promise<ScannerResult>;
