/**
 * Storage for tracking fix workflow state and completed fixes
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getRoverDir, ensureRoverDir } from './issues.js';
const FIX_STATE_FILE = 'fix-state.json';
const FIX_STATE_VERSION = '1.0.0';
/**
 * Get the path to the fix state file
 */
export function getFixStatePath(targetPath) {
    return join(getRoverDir(targetPath), FIX_STATE_FILE);
}
/**
 * Load existing fix state from disk
 */
export async function loadFixState(targetPath) {
    const statePath = getFixStatePath(targetPath);
    if (!existsSync(statePath)) {
        return null;
    }
    try {
        const content = await readFile(statePath, 'utf-8');
        const state = JSON.parse(content);
        // Validate required fields
        if (!state.version || !state.fixes) {
            return null;
        }
        return state;
    }
    catch (error) {
        if (error instanceof SyntaxError) {
            console.error(`Warning: Corrupted fix state file, ignoring: ${error.message}`);
            return null;
        }
        throw error;
    }
}
/**
 * Save fix state to disk
 */
export async function saveFixState(targetPath, state) {
    await ensureRoverDir(targetPath);
    const statePath = getFixStatePath(targetPath);
    state.lastUpdatedAt = new Date().toISOString();
    const content = JSON.stringify(state, null, 2);
    await writeFile(statePath, content, 'utf-8');
}
/**
 * Create a new empty fix state
 */
export function createFixState(targetPath) {
    return {
        version: FIX_STATE_VERSION,
        targetPath,
        fixes: [],
        lastUpdatedAt: new Date().toISOString(),
    };
}
/**
 * Get or create fix state
 */
export async function getOrCreateFixState(targetPath) {
    const existing = await loadFixState(targetPath);
    if (existing) {
        return existing;
    }
    return createFixState(targetPath);
}
/**
 * Add or update a fix record
 */
export function upsertFixRecord(state, record) {
    const existingIndex = state.fixes.findIndex(f => f.issueId === record.issueId);
    if (existingIndex >= 0) {
        // Update existing
        const fixes = [...state.fixes];
        fixes[existingIndex] = record;
        return { ...state, fixes };
    }
    else {
        // Add new
        return { ...state, fixes: [...state.fixes, record] };
    }
}
/**
 * Get a fix record by issue ID
 */
export function getFixRecord(state, issueId) {
    return state.fixes.find(f => f.issueId === issueId);
}
/**
 * Get all fixes ready for review (ready_for_review status)
 */
export function getFixesReadyForReview(state) {
    return state.fixes.filter(f => f.status === 'ready_for_review');
}
/**
 * Get all fixes that have PRs created
 */
export function getFixesWithPRs(state) {
    return state.fixes.filter(f => f.status === 'pr_created' && f.prUrl);
}
/**
 * Get all active fixes (not merged or error)
 */
export function getActiveFixes(state) {
    return state.fixes.filter(f => f.status === 'in_progress' ||
        f.status === 'ready_for_review' ||
        f.status === 'pr_created');
}
/**
 * Remove a fix record
 */
export function removeFixRecord(state, issueId) {
    return {
        ...state,
        fixes: state.fixes.filter(f => f.issueId !== issueId),
    };
}
/**
 * Update the status of a fix record
 */
export function updateFixStatus(state, issueId, status, updates) {
    const fixes = state.fixes.map(f => {
        if (f.issueId !== issueId) {
            return f;
        }
        return {
            ...f,
            status,
            ...updates,
        };
    });
    return { ...state, fixes };
}
// ============================================================================
// Fix Trace Storage
// ============================================================================
const TRACES_DIR = 'traces';
/**
 * Get the path to the traces directory
 */
export function getTracesDir(targetPath) {
    return join(getRoverDir(targetPath), TRACES_DIR);
}
/**
 * Get the path to a specific trace file
 */
export function getTracePath(targetPath, issueId) {
    return join(getTracesDir(targetPath), `${issueId}.json`);
}
/**
 * Ensure the traces directory exists
 */
async function ensureTracesDir(targetPath) {
    await ensureRoverDir(targetPath);
    const tracesDir = getTracesDir(targetPath);
    if (!existsSync(tracesDir)) {
        await mkdir(tracesDir, { recursive: true });
    }
}
/**
 * Save a fix trace to disk
 */
export async function saveFixTrace(targetPath, trace) {
    await ensureTracesDir(targetPath);
    const tracePath = getTracePath(targetPath, trace.issueId);
    const content = JSON.stringify(trace, null, 2);
    await writeFile(tracePath, content, 'utf-8');
}
/**
 * Load a fix trace from disk
 */
export async function loadFixTrace(targetPath, issueId) {
    const tracePath = getTracePath(targetPath, issueId);
    if (!existsSync(tracePath)) {
        return null;
    }
    try {
        const content = await readFile(tracePath, 'utf-8');
        return JSON.parse(content);
    }
    catch (error) {
        if (error instanceof SyntaxError) {
            console.error(`Warning: Corrupted trace file for ${issueId}, ignoring: ${error.message}`);
            return null;
        }
        throw error;
    }
}
