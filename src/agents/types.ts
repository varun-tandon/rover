import type { CandidateIssue, ApprovedIssue, IssueSummary } from '../types/index.js';

/**
 * Result from running the scanner agent
 */
export interface ScannerResult {
  /** Candidate issues detected */
  issues: CandidateIssue[];
  /** Duration in milliseconds */
  durationMs: number;
  /** Files scanned */
  filesScanned: number;
}

/**
 * Result from the arbitrator
 */
export interface ArbitratorResult {
  /** Issues that received majority approval */
  approvedIssues: ApprovedIssue[];
  /** Issues that were rejected */
  rejectedIssues: CandidateIssue[];
  /** Tickets created */
  ticketsCreated: string[];
}

/**
 * Options for running the scanner agent
 */
export interface ScannerOptions {
  /** Target directory to scan */
  targetPath: string;
  /** Agent ID to use */
  agentId: string;
  /** Existing issues summary for deduplication */
  existingIssues: IssueSummary[];
  /**
   * Callback for progress updates during scanning.
   *
   * Called by `runScanner` at various stages:
   * - When summarizing existing issues for deduplication
   * - When starting the scan
   * - When searching for files (Glob tool)
   * - When reading files (Read tool)
   * - When searching for patterns (Grep tool)
   * - On scan completion or error
   *
   * Used to display real-time progress in the terminal UI.
   *
   * @param message - Human-readable description of current activity
   */
  onProgress?: (message: string) => void;
}

/**
 * Result from the checker
 */
export interface CheckerResult {
  /** IDs of approved issues */
  approvedIds: string[];
  /** IDs of rejected issues */
  rejectedIds: string[];
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Options for running the checker
 */
export interface CheckerOptions {
  /** Target directory for context */
  targetPath: string;
  /** Agent definition context */
  agentId: string;
  /** Candidate issues to check */
  issues: CandidateIssue[];
  /**
   * Callback for progress updates during batch checking.
   *
   * Called by `runChecker` before and after checking each batch of issues:
   * - Before checking: `onProgress(issueCount, false)` - batch checking about to start
   * - After checking: `onProgress(issueCount, true)` - batch decisions made
   *
   * @param issueCount - The number of issues in this batch
   * @param completed - Whether the check for this batch has completed
   */
  onProgress?: (issueCount: number, completed: boolean) => void;
}

/**
 * Options for the arbitrator
 */
export interface ArbitratorOptions {
  /** Target directory */
  targetPath: string;
  /** All candidate issues */
  candidateIssues: CandidateIssue[];
  /** IDs of issues approved by the checker */
  approvedIds: string[];
}
