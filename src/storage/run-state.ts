import { readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getRoverDir, ensureRoverDir } from './issues.js';

const RUN_STATE_FILE = 'batch-run-state.json';
const RUN_STATE_VERSION = '1.0.0';

/**
 * 24 hours in milliseconds.
 * Runs older than this threshold are considered stale and will be ignored,
 * prompting a fresh start instead of resume.
 */
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

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
  costUsd: number;
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
export function getRunStatePath(targetPath: string): string {
  return join(getRoverDir(targetPath), RUN_STATE_FILE);
}

/**
 * Load existing run state from disk.
 * Returns null if no state file exists or if the file is corrupted.
 * Marks the state as stale if older than STALE_THRESHOLD_MS.
 */
export async function loadRunState(targetPath: string): Promise<BatchRunState | null> {
  const statePath = getRunStatePath(targetPath);

  if (!existsSync(statePath)) {
    return null;
  }

  try {
    const content = await readFile(statePath, 'utf-8');
    const state = JSON.parse(content) as BatchRunState;

    // Validate required fields
    if (!state.version || !state.runId || !state.agents) {
      return null;
    }

    // Mark as stale if older than threshold
    const startTime = new Date(state.startedAt).getTime();
    if (Date.now() - startTime > STALE_THRESHOLD_MS) {
      state.isStale = true;
    }

    return state;
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error(`Warning: Corrupted run state file, ignoring: ${error.message}`);
      return null;
    }
    throw error;
  }
}

/**
 * Save run state to disk
 */
export async function saveRunState(
  targetPath: string,
  state: BatchRunState
): Promise<void> {
  await ensureRoverDir(targetPath);
  const statePath = getRunStatePath(targetPath);
  const content = JSON.stringify(state, null, 2);
  await writeFile(statePath, content, 'utf-8');
}

/**
 * Delete the run state file
 */
export async function clearRunState(targetPath: string): Promise<void> {
  const statePath = getRunStatePath(targetPath);
  if (existsSync(statePath)) {
    await unlink(statePath);
  }
}

/**
 * Create a new run state for a fresh batch run
 */
export function createRunState(
  targetPath: string,
  agentIds: string[],
  concurrency: number,
  getAgentName?: (id: string) => string
): BatchRunState {
  return {
    runId: `run-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    version: RUN_STATE_VERSION,
    targetPath,
    requestedAgentIds: agentIds,
    agents: agentIds.map(id => ({
      agentId: id,
      agentName: getAgentName?.(id) ?? id,
      status: 'pending' as const
    })),
    startedAt: new Date().toISOString(),
    completedAt: null,
    concurrency
  };
}

/**
 * Check if a run state represents an incomplete run
 */
export function isRunIncomplete(state: BatchRunState): boolean {
  return state.completedAt === null;
}

/**
 * Get agent IDs that completed successfully (to skip on resume)
 */
export function getCompletedAgentIds(state: BatchRunState): string[] {
  return state.agents
    .filter(a => a.status === 'completed')
    .map(a => a.agentId);
}

/**
 * Get agent IDs that need to run (pending or errored)
 */
export function getAgentsToRun(state: BatchRunState): string[] {
  return state.agents
    .filter(a => a.status === 'pending' || a.status === 'error')
    .map(a => a.agentId);
}

/**
 * Update the status of a specific agent in the run state.
 * Returns a new state object (does not mutate).
 */
export function updateAgentStatus(
  state: BatchRunState,
  agentId: string,
  status: AgentRunStatus,
  options?: {
    error?: string;
    result?: AgentResultSummary;
    agentName?: string;
  }
): BatchRunState {
  const agents = state.agents.map(agent => {
    if (agent.agentId !== agentId) {
      return agent;
    }

    const updated: AgentRunState = {
      ...agent,
      status,
      agentName: options?.agentName ?? agent.agentName
    };

    if (status === 'completed' || status === 'error') {
      updated.completedAt = new Date().toISOString();
    }

    if (status === 'error' && options?.error) {
      updated.error = options.error;
    }

    if (status === 'completed' && options?.result) {
      updated.result = options.result;
    }

    return updated;
  });

  return { ...state, agents };
}

/**
 * Mark the run as complete
 */
export function markRunComplete(state: BatchRunState): BatchRunState {
  return {
    ...state,
    completedAt: new Date().toISOString()
  };
}
