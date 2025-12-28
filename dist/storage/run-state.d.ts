/**
 * Status of an individual agent within a batch run
 */
export type AgentRunStatus = 'pending' | 'running' | 'completed' | 'error';
/**
 * Summary of agent results stored in run state (minimal to keep file small)
 */
export interface AgentResultSummary {
    candidateIssues: number;
    approvedIssues: number;
    rejectedIssues: number;
    ticketsCreated: number;
}
/**
 * Persisted state for a single agent in a batch run
 */
export interface AgentRunState {
    agentId: string;
    agentName: string;
    status: AgentRunStatus;
    /** Error message if status is 'error' */
    error?: string;
    /** Timestamp when agent completed (success or error) */
    completedAt?: string;
    /** Summary of results if completed successfully */
    result?: AgentResultSummary;
}
/**
 * Persisted state for an entire batch run.
 * Stored in .rover/batch-run-state.json
 */
export interface BatchRunState {
    /** Unique ID for this run */
    runId: string;
    /** Schema version for future migrations */
    version: string;
    /** Target path being scanned */
    targetPath: string;
    /** All agent IDs that were requested for this run */
    requestedAgentIds: string[];
    /** Current status of each agent */
    agents: AgentRunState[];
    /** Timestamp when run started */
    startedAt: string;
    /** Timestamp when run completed (null if incomplete) */
    completedAt: string | null;
    /** Concurrency setting used */
    concurrency: number;
    /** Whether this run is considered stale (set during load if older than threshold) */
    isStale?: boolean;
}
/**
 * Get the path to the run state file
 */
export declare function getRunStatePath(targetPath: string): string;
/**
 * Load existing run state from disk.
 * Returns null if no state file exists or if the file is corrupted.
 * Marks the state as stale if older than STALE_THRESHOLD_MS.
 */
export declare function loadRunState(targetPath: string): Promise<BatchRunState | null>;
/**
 * Save run state to disk
 */
export declare function saveRunState(targetPath: string, state: BatchRunState): Promise<void>;
/**
 * Delete the run state file
 */
export declare function clearRunState(targetPath: string): Promise<void>;
/**
 * Create a new run state for a fresh batch run
 */
export declare function createRunState(targetPath: string, agentIds: string[], concurrency: number, getAgentName?: (id: string) => string): BatchRunState;
/**
 * Check if a run state represents an incomplete run
 */
export declare function isRunIncomplete(state: BatchRunState): boolean;
/**
 * Get agent IDs that completed successfully (to skip on resume)
 */
export declare function getCompletedAgentIds(state: BatchRunState): string[];
/**
 * Get agent IDs that need to run (pending or errored)
 */
export declare function getAgentsToRun(state: BatchRunState): string[];
/**
 * Update the status of a specific agent in the run state.
 * Returns a new state object (does not mutate).
 */
export declare function updateAgentStatus(state: BatchRunState, agentId: string, status: AgentRunStatus, options?: {
    error?: string;
    result?: AgentResultSummary;
    agentName?: string;
}): BatchRunState;
/**
 * Mark the run as complete
 */
export declare function markRunComplete(state: BatchRunState): BatchRunState;
