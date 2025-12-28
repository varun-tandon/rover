/**
 * Main orchestration for the fix workflow
 */
import type { FixOptions, FixResult, FixProgress, BatchFixOptions, BatchFixResult, BatchFixProgress } from './types.js';
/**
 * Run the fix workflow for multiple issues in parallel
 */
export declare function runFix(options: FixOptions, onProgress: (progress: FixProgress) => void): Promise<FixResult[]>;
/**
 * Run batch fix workflow: fix multiple issues on a single branch with one review at the end.
 *
 * Flow:
 * 1. Create single worktree/branch for all issues
 * 2. Fix each issue sequentially (no review between issues)
 * 3. Run single combined review at the end
 * 4. If review has issues, iterate (fix all remaining, review again)
 */
export declare function runBatchFix(options: BatchFixOptions, onProgress: (progress: BatchFixProgress) => void): Promise<BatchFixResult>;
