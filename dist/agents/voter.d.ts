import type { CandidateIssue } from '../types/index.js';
import type { VoterResult, VoterOptions } from './types.js';
/**
 * Run a voter agent to validate candidate issues.
 *
 * Each voter independently reviews candidate issues by reading the actual source files
 * and deciding whether each issue is genuine and worth addressing. Voters provide
 * approve/reject votes with reasoning for each issue.
 *
 * @param options - Configuration for the voter
 * @param options.voterId - Unique identifier for this voter (e.g., 'voter-1')
 * @param options.targetPath - Absolute path to the codebase for reading source files
 * @param options.agentId - ID of the agent that detected the issues (for context)
 * @param options.issues - Array of candidate issues to vote on
 * @param options.onProgress - Optional callback invoked before/after each issue vote
 * @returns Voting results including all votes cast, timing, and cost information
 * @throws Error if the specified agent ID is not found
 */
export declare function runVoter(options: VoterOptions): Promise<VoterResult>;
/**
 * Run multiple voters in parallel to validate candidate issues.
 *
 * Creates multiple independent voter agents that concurrently review all candidate issues.
 * Each voter has its own perspective and voting decisions, enabling consensus-based validation.
 *
 * @param targetPath - Absolute path to the codebase for reading source files
 * @param agentId - ID of the agent that detected the issues (for context)
 * @param issues - Array of candidate issues for all voters to evaluate
 * @param voterCount - Number of parallel voters to run (default: 3 for 2/3 majority voting)
 * @param onProgress - Optional callback invoked for each voter's progress on each issue.
 *   Called with (voterId, issueId, completed) where completed indicates vote was cast.
 * @returns Array of VoterResult objects, one per voter, containing all votes and metadata
 *
 * @example
 * const results = await runVotersInParallel(
 *   '/path/to/codebase',
 *   'critical-path-scout',
 *   candidateIssues,
 *   3,
 *   (voterId, issueId, done) => console.log(`${voterId}: ${issueId} ${done ? 'done' : 'voting'}`)
 * );
 */
export declare function runVotersInParallel(targetPath: string, agentId: string, issues: CandidateIssue[], voterCount?: number, onProgress?: (voterId: string, issueId: string, completed: boolean) => void): Promise<VoterResult[]>;
