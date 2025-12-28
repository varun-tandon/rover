/**
 * Storage for tracking fix workflow state and completed fixes
 */
import type { FixTrace } from '../fix/types.js';
/**
 * Status of a fix
 */
export type FixRecordStatus = 'in_progress' | 'ready_for_review' | 'pr_created' | 'merged' | 'error';
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
export declare function getFixStatePath(targetPath: string): string;
/**
 * Load existing fix state from disk
 */
export declare function loadFixState(targetPath: string): Promise<FixState | null>;
/**
 * Save fix state to disk
 */
export declare function saveFixState(targetPath: string, state: FixState): Promise<void>;
/**
 * Create a new empty fix state
 */
export declare function createFixState(targetPath: string): FixState;
/**
 * Get or create fix state
 */
export declare function getOrCreateFixState(targetPath: string): Promise<FixState>;
/**
 * Add or update a fix record
 */
export declare function upsertFixRecord(state: FixState, record: FixRecord): FixState;
/**
 * Get a fix record by issue ID
 */
export declare function getFixRecord(state: FixState, issueId: string): FixRecord | undefined;
/**
 * Get all fixes ready for review (ready_for_review status)
 */
export declare function getFixesReadyForReview(state: FixState): FixRecord[];
/**
 * Get all fixes that have PRs created
 */
export declare function getFixesWithPRs(state: FixState): FixRecord[];
/**
 * Get all active fixes (not merged or error)
 */
export declare function getActiveFixes(state: FixState): FixRecord[];
/**
 * Remove a fix record
 */
export declare function removeFixRecord(state: FixState, issueId: string): FixState;
/**
 * Update the status of a fix record
 */
export declare function updateFixStatus(state: FixState, issueId: string, status: FixRecordStatus, updates?: Partial<Pick<FixRecord, 'prUrl' | 'prNumber' | 'error' | 'completedAt'>>): FixState;
/**
 * Get the path to the traces directory
 */
export declare function getTracesDir(targetPath: string): string;
/**
 * Get the path to a specific trace file
 */
export declare function getTracePath(targetPath: string, issueId: string): string;
/**
 * Save a fix trace to disk
 */
export declare function saveFixTrace(targetPath: string, trace: FixTrace): Promise<void>;
/**
 * Load a fix trace from disk
 */
export declare function loadFixTrace(targetPath: string, issueId: string): Promise<FixTrace | null>;
