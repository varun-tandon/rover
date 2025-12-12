/**
 * Core types for the Rover codebase scanner
 */

/**
 * Definition of a scanning agent (e.g., Critical Path Scout)
 */
export interface AgentDefinition {
  /** Unique identifier for the agent */
  id: string;
  /** Human-readable name */
  name: string;
  /** Brief description of what this agent detects */
  description: string;
  /** System prompt that defines the agent's behavior and guidelines */
  systemPrompt: string;
  /** Glob patterns for files this agent should scan */
  filePatterns: string[];
}

/**
 * Severity levels for detected issues
 */
export type IssueSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * A candidate issue detected by a scanner agent, pending validation
 */
export interface CandidateIssue {
  /** Unique identifier for this issue */
  id: string;
  /** ID of the agent that detected this issue */
  agentId: string;
  /** Short title describing the issue */
  title: string;
  /** Detailed description of the problem */
  description: string;
  /** Severity level */
  severity: IssueSeverity;
  /** Path to the file containing the issue */
  filePath: string;
  /** Optional line range where the issue occurs */
  lineRange?: {
    start: number;
    end: number;
  };
  /** Category of the issue (e.g., "Bundle Bloat", "Provider Hell") */
  category: string;
  /** Recommended fix or action */
  recommendation: string;
  /** Optional code snippet showing the problematic code */
  codeSnippet?: string;
}

/**
 * A vote from a validation agent on a candidate issue
 */
export interface Vote {
  /** Identifier for the voter (e.g., "voter-1", "voter-2") */
  voterId: string;
  /** ID of the issue being voted on */
  issueId: string;
  /** Whether the voter approves this issue as valid */
  approve: boolean;
  /** Reasoning behind the vote */
  reasoning: string;
}

/**
 * An issue that has been approved by majority vote
 */
export interface ApprovedIssue extends CandidateIssue {
  /** All votes cast for this issue */
  votes: Vote[];
  /** ISO timestamp when the issue was approved */
  approvedAt: string;
  /** Path to the generated ticket file */
  ticketPath: string;
}

/**
 * Persistent storage for detected issues
 */
export interface IssueStore {
  /** Schema version for migrations */
  version: string;
  /** All approved issues */
  issues: ApprovedIssue[];
  /** ISO timestamp of last scan */
  lastScanAt: string;
}

/**
 * Summary of an existing issue for deduplication
 */
export interface IssueSummary {
  /** Issue ID */
  id: string;
  /** Issue title */
  title: string;
  /** File path */
  filePath: string;
  /** Category */
  category: string;
}

/**
 * Status of the scanning phase
 */
export type ScanStatus = 'idle' | 'scanning' | 'completed' | 'error';

/**
 * Status of the voting phase
 */
export type VotingStatus = 'idle' | 'voting' | 'completed' | 'error';

/**
 * Status of an individual voter
 */
export interface VoterStatus {
  /** Voter identifier */
  id: string;
  /** Current status */
  status: 'pending' | 'voting' | 'completed' | 'error';
  /** Number of votes cast */
  votesCompleted: number;
  /** Total votes to cast */
  totalVotes: number;
}

/**
 * Overall scan result
 */
export interface ScanResult {
  /** Agent that performed the scan */
  agentId: string;
  /** Target path that was scanned */
  targetPath: string;
  /** Candidate issues found */
  candidateIssues: CandidateIssue[];
  /** Issues approved after voting */
  approvedIssues: ApprovedIssue[];
  /** Total duration in milliseconds */
  durationMs: number;
  /** ISO timestamp of scan completion */
  completedAt: string;
}

/**
 * CLI flags passed to the rover command
 */
export interface CliFlags {
  /** Specific agent to run (or undefined for all) */
  agent?: string;
  /** Dry run mode - show what would be scanned */
  dryRun: boolean;
  /** Verbose output */
  verbose?: boolean;
}

/**
 * Application state for the Ink CLI
 */
export interface AppState {
  /** Current phase */
  phase: 'init' | 'scanning' | 'voting' | 'arbitrating' | 'complete' | 'error';
  /** Target path being scanned */
  targetPath: string;
  /** Agent being used */
  agentId: string;
  /** Scan status */
  scanStatus: ScanStatus;
  /** Candidate issues from scanning */
  candidateIssues: CandidateIssue[];
  /** Voting status */
  votingStatus: VotingStatus;
  /** Status of each voter */
  voterStatuses: VoterStatus[];
  /** All votes collected */
  votes: Vote[];
  /** Final approved issues */
  approvedIssues: ApprovedIssue[];
  /** Error message if any */
  error?: string;
}

/**
 * JSON schema for structured output from scanner agent
 */
export const candidateIssuesSchema = {
  type: 'object',
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          filePath: { type: 'string' },
          lineRange: {
            type: 'object',
            properties: {
              start: { type: 'number' },
              end: { type: 'number' }
            },
            required: ['start', 'end']
          },
          category: { type: 'string' },
          recommendation: { type: 'string' },
          codeSnippet: { type: 'string' }
        },
        required: ['id', 'title', 'description', 'severity', 'filePath', 'category', 'recommendation']
      }
    }
  },
  required: ['issues']
} as const;

/**
 * JSON schema for structured output from voter agent
 */
export const voteSchema = {
  type: 'object',
  properties: {
    approve: { type: 'boolean' },
    reasoning: { type: 'string' }
  },
  required: ['approve', 'reasoning']
} as const;
