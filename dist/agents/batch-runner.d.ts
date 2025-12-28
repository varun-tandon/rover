import type { ScannerResult, CheckerResult, ArbitratorResult } from './types.js';
import type { AgentRunStatus } from '../storage/run-state.js';
/**
 * Progress update during batch agent execution.
 * Emitted via the onProgress callback to track the current state of batch processing.
 */
export interface BatchProgress {
    /** Current phase of the pipeline for this agent */
    phase: 'scanning' | 'checking' | 'saving';
    /** Unique identifier of the agent currently being processed */
    agentId: string;
    /** Human-readable name of the agent */
    agentName: string;
    /** Number of agents that have completed processing */
    completedCount: number;
    /** Total number of agents in this batch run */
    totalAgents: number;
    /** Human-readable status message describing current activity */
    message: string;
    /** Number of issues checked (only present during 'checking' phase) */
    issuesChecked?: number;
    /** Total issues to check (only present during 'checking' phase) */
    issuesToCheck?: number;
}
/**
 * Complete result from running a single agent through the scan-check-save pipeline.
 * Contains all outputs from each phase plus metadata about the agent.
 */
export interface AgentResult {
    /** Unique identifier of the agent */
    agentId: string;
    /** Human-readable name of the agent */
    agentName: string;
    /** Results from the scanning phase (candidate issues found) */
    scanResult: ScannerResult;
    /** Results from the checker (approved/rejected issue IDs) */
    checkerResult: CheckerResult;
    /** Final results (approved/rejected issues, tickets created) */
    arbitratorResult: ArbitratorResult;
    /** Error message if the agent failed during execution. When set, other results may be empty. */
    error?: string;
}
/**
 * Aggregated results from running multiple agents in batch mode.
 * Contains individual agent results plus summary statistics across all agents.
 */
export interface BatchRunResult {
    /** Results from each individual agent */
    agentResults: AgentResult[];
    /** Total number of candidate issues found across all agents */
    totalCandidateIssues: number;
    /** Total number of issues that passed checking and were approved */
    totalApprovedIssues: number;
    /** Total number of issues that were rejected by the checker */
    totalRejectedIssues: number;
    /** Total number of ticket files created */
    totalTickets: number;
    /** Total elapsed time for the batch run in milliseconds */
    totalDurationMs: number;
    /** Number of agents that failed during execution */
    failedAgents: number;
    /** Number of agents skipped (already completed in resumed run) */
    skippedAgents: number;
}
/**
 * Orchestrates batch scanning of a codebase using multiple agents with a work queue pattern.
 * Each agent runs through the full pipeline: scan -> check -> save.
 *
 * @param targetPath - Absolute path to the codebase directory to scan
 * @param agentIds - List of specific agent IDs to run, or 'all' to run all registered agents
 * @param options - Configuration options for batch execution
 * @param options.concurrency - Maximum number of agents to run in parallel (default: 8)
 * @param options.onProgress - Callback invoked with progress updates during scan/vote/arbitrate phases
 * @param options.onAgentComplete - Callback invoked when each agent completes (success or failure)
 * @returns Aggregated results including individual agent results and summary statistics
 *
 * @remarks
 * - Uses a work queue pattern where multiple workers pull agents from a shared queue
 * - Failed agents are tracked via the `error` field in AgentResult and `failedAgents` count
 * - Transient errors (network issues, JSON parsing) are retried up to MAX_RETRIES times
 */
export declare function runAgentsBatched(targetPath: string, agentIds: string[] | 'all', options?: {
    concurrency?: number;
    onProgress?: (progress: BatchProgress) => void;
    onAgentComplete?: (result: AgentResult) => void;
    /** Agent IDs to skip (already completed in a previous run) */
    skipAgentIds?: string[];
    /** Callback when agent status changes (for state persistence) */
    onStateChange?: (agentId: string, status: AgentRunStatus, result?: AgentResult) => void;
}): Promise<BatchRunResult>;
/**
 * Get agent IDs grouped by category for UI display purposes.
 *
 * Returns a mapping of human-readable category names to arrays of agent IDs.
 * Useful for organizing agents in the CLI help output or selection UI.
 *
 * @returns Record mapping category names to agent ID arrays
 *
 * Categories:
 * - **Architecture**: Code structure, dependencies, abstraction issues
 * - **React**: React-specific patterns and anti-patterns
 * - **Clarity**: Naming, documentation, code obviousness
 * - **Consistency**: Style and pattern consistency
 * - **Bugs**: Logic errors, exception handling issues
 * - **Security**: Security vulnerabilities, config exposure
 *
 * @example
 * const categories = getAgentsByCategory();
 * // { 'Architecture': ['critical-path-scout', ...], 'React': [...], ... }
 */
export declare function getAgentsByCategory(): Record<string, string[]>;
