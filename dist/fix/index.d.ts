/**
 * Main orchestration for the fix workflow
 */
import type { FixOptions, FixResult, FixProgress } from './types.js';
/**
 * Run the fix workflow for multiple issues in parallel
 */
export declare function runFix(options: FixOptions, onProgress: (progress: FixProgress) => void): Promise<FixResult[]>;
