/**
 * Types for the rover fix workflow
 */

export interface FixOptions {
  targetPath: string;
  issueIds: string[];
  concurrency: number;
  maxIterations: number;
  verbose: boolean;
}

export interface FixFlags {
  concurrency: number;
  maxIterations: number;
  verbose: boolean;
}

export type FixStatus = 'success' | 'iteration_limit' | 'error' | 'already_fixed';

export interface FixResult {
  issueId: string;
  status: FixStatus;
  worktreePath: string;
  branchName: string;
  iterations: number;
  error?: string;
  durationMs: number;
}

export type FixPhase =
  | 'pending'
  | 'worktree'
  | 'fixing'
  | 'reviewing'
  | 'iterating'
  | 'complete'
  | 'already_fixed'
  | 'error';

export interface FixProgress {
  issueId: string;
  phase: FixPhase;
  iteration: number;
  maxIterations: number;
  message: string;
  actionableItems?: number;
}

export interface IssueContext {
  id: string;
  content: string;
  ticketPath: string;
}

export interface ClaudeResult {
  sessionId: string;
  output: string;
  exitCode: number;
}

export interface ReviewItem {
  severity: 'must_fix' | 'should_fix' | 'suggestion';
  description: string;
  file?: string;
}

export interface ReviewAnalysis {
  isClean: boolean;
  items: ReviewItem[];
}

export interface ReviewTrace {
  architectureOutput: string;
  bugOutput: string;
  completenessOutput: string;
  combinedOutput: string;
  parsedItems: ReviewItem[];
  actionableCount: number;
}

export interface IterationTrace {
  iteration: number;
  startedAt: string;
  completedAt: string;

  // Claude execution
  claudeSessionId?: string;
  claudeOutput: string;
  claudeExitCode: number;

  // Markers detected
  alreadyFixed: boolean;
  reviewNotApplicable: boolean;

  // Review (if run)
  review?: ReviewTrace;
}

export interface FixTrace {
  issueId: string;
  startedAt: string;
  completedAt?: string;
  iterations: IterationTrace[];
  finalStatus: FixStatus;
  error?: string;
}

/**
 * Options for batch fixing multiple issues in a single branch
 */
export interface BatchFixOptions {
  targetPath: string;
  issueIds: string[];
  maxIterations: number;
  verbose: boolean;
}

/**
 * Result from fixing a single issue within a batch
 */
export interface BatchIssueResult {
  issueId: string;
  status: 'success' | 'skipped' | 'error';
  error?: string;
}

/**
 * Result from a batch fix operation
 */
export interface BatchFixResult {
  /** Branch name for the combined fix */
  branchName: string;
  /** Path to the worktree */
  worktreePath: string;
  /** Results for each issue in the batch */
  issueResults: BatchIssueResult[];
  /** Overall status */
  status: 'success' | 'partial' | 'error';
  /** Number of successful fixes */
  successCount: number;
  /** Number of skipped/failed fixes */
  failedCount: number;
  /** Total iterations used in final review */
  iterations: number;
  /** Duration in milliseconds */
  durationMs: number;
  /** Error message if overall failure */
  error?: string;
}

/**
 * Progress update during batch fix
 */
export interface BatchFixProgress {
  phase: 'worktree' | 'fixing' | 'reviewing' | 'complete' | 'error';
  currentIssueId?: string;
  currentIssueIndex?: number;
  totalIssues: number;
  message: string;
  iteration?: number;
  maxIterations?: number;
}
