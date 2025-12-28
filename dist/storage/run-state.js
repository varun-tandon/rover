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
 * Get the path to the run state file
 */
export function getRunStatePath(targetPath) {
    return join(getRoverDir(targetPath), RUN_STATE_FILE);
}
/**
 * Load existing run state from disk.
 * Returns null if no state file exists or if the file is corrupted.
 * Marks the state as stale if older than STALE_THRESHOLD_MS.
 */
export async function loadRunState(targetPath) {
    const statePath = getRunStatePath(targetPath);
    if (!existsSync(statePath)) {
        return null;
    }
    try {
        const content = await readFile(statePath, 'utf-8');
        const state = JSON.parse(content);
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
    }
    catch (error) {
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
export async function saveRunState(targetPath, state) {
    await ensureRoverDir(targetPath);
    const statePath = getRunStatePath(targetPath);
    const content = JSON.stringify(state, null, 2);
    await writeFile(statePath, content, 'utf-8');
}
/**
 * Delete the run state file
 */
export async function clearRunState(targetPath) {
    const statePath = getRunStatePath(targetPath);
    if (existsSync(statePath)) {
        await unlink(statePath);
    }
}
/**
 * Create a new run state for a fresh batch run
 */
export function createRunState(targetPath, agentIds, concurrency, getAgentName) {
    return {
        runId: `run-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        version: RUN_STATE_VERSION,
        targetPath,
        requestedAgentIds: agentIds,
        agents: agentIds.map(id => ({
            agentId: id,
            agentName: getAgentName?.(id) ?? id,
            status: 'pending'
        })),
        startedAt: new Date().toISOString(),
        completedAt: null,
        concurrency
    };
}
/**
 * Check if a run state represents an incomplete run
 */
export function isRunIncomplete(state) {
    return state.completedAt === null;
}
/**
 * Get agent IDs that completed successfully (to skip on resume)
 */
export function getCompletedAgentIds(state) {
    return state.agents
        .filter(a => a.status === 'completed')
        .map(a => a.agentId);
}
/**
 * Get agent IDs that need to run (pending or errored)
 */
export function getAgentsToRun(state) {
    return state.agents
        .filter(a => a.status === 'pending' || a.status === 'error')
        .map(a => a.agentId);
}
/**
 * Update the status of a specific agent in the run state.
 * Returns a new state object (does not mutate).
 */
export function updateAgentStatus(state, agentId, status, options) {
    const agents = state.agents.map(agent => {
        if (agent.agentId !== agentId) {
            return agent;
        }
        const updated = {
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
export function markRunComplete(state) {
    return {
        ...state,
        completedAt: new Date().toISOString()
    };
}
