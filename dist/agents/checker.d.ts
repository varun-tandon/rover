import type { CheckerResult, CheckerOptions } from './types.js';
/**
 * Run a checker agent to validate candidate issues.
 *
 * The checker reviews all candidate issues by reading the actual source files
 * and deciding whether each issue is genuine and worth addressing.
 *
 * Issues are validated in batches of up to 10 for efficiency.
 *
 * @param options - Configuration for the checker
 * @param options.targetPath - Absolute path to the codebase for reading source files
 * @param options.agentId - ID of the agent that detected the issues (for context)
 * @param options.issues - Array of candidate issues to check
 * @param options.onProgress - Optional callback invoked for batch progress
 * @returns Checking results including approved/rejected issues
 * @throws Error if the specified agent ID is not found
 */
export declare function runChecker(options: CheckerOptions): Promise<CheckerResult>;
