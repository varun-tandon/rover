import type { CandidateIssue, Vote, ApprovedIssue, IssueSummary } from '../types/index.js';

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
 * Result from a single voter
 */
export interface VoterResult {
  /** Voter ID */
  voterId: string;
  /** Votes cast by this voter */
  votes: Vote[];
  /** Duration in milliseconds */
  durationMs: number;
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
 * Options for running a voter agent
 */
export interface VoterOptions {
  /** Voter ID (1, 2, or 3) */
  voterId: string;
  /** Target directory for context */
  targetPath: string;
  /** Agent definition context */
  agentId: string;
  /** Candidate issues to vote on */
  issues: CandidateIssue[];
  /**
   * Callback for progress updates during voting.
   *
   * Called by `runVoter` before and after voting on each issue:
   * - Before voting: `onProgress(issueId, false)` - voting about to start
   * - After voting: `onProgress(issueId, true)` - vote cast (approve or reject)
   *
   * Used to track real-time voting progress in the terminal UI.
   *
   * @param issueId - The ID of the issue being voted on
   * @param completed - Whether the vote for this issue has been cast
   */
  onProgress?: (issueId: string, completed: boolean) => void;
}

/**
 * Options for the arbitrator
 */
export interface ArbitratorOptions {
  /** Target directory */
  targetPath: string;
  /** All candidate issues */
  candidateIssues: CandidateIssue[];
  /** All votes from all voters */
  votes: Vote[];
  /** Minimum votes needed for approval (default: 2 out of 3) */
  minimumVotes?: number;
}
