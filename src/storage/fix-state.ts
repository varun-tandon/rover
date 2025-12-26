/**
 * Storage for tracking fix workflow state and completed fixes
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getRoverDir, ensureRoverDir } from './issues.js';

const FIX_STATE_FILE = 'fix-state.json';
const FIX_STATE_VERSION = '1.0.0';

/**
 * Status of a fix
 */
export type FixRecordStatus =
  | 'in_progress'
  | 'ready_for_review'
  | 'pr_created'
  | 'merged'
  | 'error';

/**
 * Record of a single fix attempt
 */
export interface FixRecord {
  /** Issue ID (e.g., ISSUE-001) */
  issueId: string;
  /** Git branch name (e.g., fix/ISSUE-001) */
  branchName: string;
  /** Absolute path to the worktree */
  worktreePath: string;
  /** Current status */
  status: FixRecordStatus;
  /** Number of iterations used */
  iterations: number;
  /** Timestamp when fix started */
  startedAt: string;
  /** Timestamp when fix completed */
  completedAt?: string;
  /** PR URL if created */
  prUrl?: string;
  /** PR number if created */
  prNumber?: number;
  /** Error message if status is 'error' */
  error?: string;
  /** Original issue content (for PR description) */
  issueContent?: string;
  /** Brief summary of the issue (first line/title) */
  issueSummary?: string;
}

/**
 * Persistent state for all fixes
 */
export interface FixState {
  /** Schema version for future migrations */
  version: string;
  /** Target path (original repo) */
  targetPath: string;
  /** All fix records */
  fixes: FixRecord[];
  /** Last updated timestamp */
  lastUpdatedAt: string;
}

/**
 * Get the path to the fix state file
 */
export function getFixStatePath(targetPath: string): string {
  return join(getRoverDir(targetPath), FIX_STATE_FILE);
}

/**
 * Load existing fix state from disk
 */
export async function loadFixState(targetPath: string): Promise<FixState | null> {
  const statePath = getFixStatePath(targetPath);

  if (!existsSync(statePath)) {
    return null;
  }

  try {
    const content = await readFile(statePath, 'utf-8');
    const state = JSON.parse(content) as FixState;

    // Validate required fields
    if (!state.version || !state.fixes) {
      return null;
    }

    return state;
  } catch (error) {
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
export async function saveFixState(
  targetPath: string,
  state: FixState
): Promise<void> {
  await ensureRoverDir(targetPath);
  const statePath = getFixStatePath(targetPath);
  state.lastUpdatedAt = new Date().toISOString();
  const content = JSON.stringify(state, null, 2);
  await writeFile(statePath, content, 'utf-8');
}

/**
 * Create a new empty fix state
 */
export function createFixState(targetPath: string): FixState {
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
export async function getOrCreateFixState(targetPath: string): Promise<FixState> {
  const existing = await loadFixState(targetPath);
  if (existing) {
    return existing;
  }
  return createFixState(targetPath);
}

/**
 * Add or update a fix record
 */
export function upsertFixRecord(
  state: FixState,
  record: FixRecord
): FixState {
  const existingIndex = state.fixes.findIndex(f => f.issueId === record.issueId);

  if (existingIndex >= 0) {
    // Update existing
    const fixes = [...state.fixes];
    fixes[existingIndex] = record;
    return { ...state, fixes };
  } else {
    // Add new
    return { ...state, fixes: [...state.fixes, record] };
  }
}

/**
 * Get a fix record by issue ID
 */
export function getFixRecord(state: FixState, issueId: string): FixRecord | undefined {
  return state.fixes.find(f => f.issueId === issueId);
}

/**
 * Get all fixes ready for review (ready_for_review status)
 */
export function getFixesReadyForReview(state: FixState): FixRecord[] {
  return state.fixes.filter(f => f.status === 'ready_for_review');
}

/**
 * Get all fixes that have PRs created
 */
export function getFixesWithPRs(state: FixState): FixRecord[] {
  return state.fixes.filter(f => f.status === 'pr_created' && f.prUrl);
}

/**
 * Get all active fixes (not merged or error)
 */
export function getActiveFixes(state: FixState): FixRecord[] {
  return state.fixes.filter(f =>
    f.status === 'in_progress' ||
    f.status === 'ready_for_review' ||
    f.status === 'pr_created'
  );
}

/**
 * Remove a fix record
 */
export function removeFixRecord(state: FixState, issueId: string): FixState {
  return {
    ...state,
    fixes: state.fixes.filter(f => f.issueId !== issueId),
  };
}

/**
 * Update the status of a fix record
 */
export function updateFixStatus(
  state: FixState,
  issueId: string,
  status: FixRecordStatus,
  updates?: Partial<Pick<FixRecord, 'prUrl' | 'prNumber' | 'error' | 'completedAt'>>
): FixState {
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
