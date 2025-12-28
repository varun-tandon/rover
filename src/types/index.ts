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
 * Status of an issue (for tracking "won't fix" issues)
 */
export type IssueStatus = 'open' | 'wont_fix';

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
 * An issue that has been approved by the checker
 */
export interface ApprovedIssue extends CandidateIssue {
  /** ISO timestamp when the issue was approved */
  approvedAt: string;
  /** Path to the generated ticket file */
  ticketPath: string;
  /** Status of the issue (undefined or 'open' = active, 'wont_fix' = ignored) */
  status?: IssueStatus;
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
 * Status of the checking phase
 */
export type CheckingStatus = 'idle' | 'checking' | 'completed' | 'error';

/**
 * Status of the checker
 */
export interface CheckerStatus {
  /** Current status */
  status: 'pending' | 'checking' | 'completed' | 'error';
  /** Number of issues checked */
  issuesChecked: number;
  /** Total issues to check */
  totalIssues: number;
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
  phase: 'init' | 'scanning' | 'checking' | 'saving' | 'complete' | 'error';
  /** Target path being scanned */
  targetPath: string;
  /** Agent being used */
  agentId: string;
  /** Scan status */
  scanStatus: ScanStatus;
  /** Candidate issues from scanning */
  candidateIssues: CandidateIssue[];
  /** Checking status */
  checkingStatus: CheckingStatus;
  /** Status of the checker */
  checkerStatus: CheckerStatus;
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
 * A cluster of related issues for consolidation
 */
export interface IssueCluster {
  /** Unique identifier for this cluster */
  id: string;
  /** Reason for clustering (e.g., "Same file: src/api/auth.ts") */
  reason: string;
  /** Issues in this cluster */
  issues: ApprovedIssue[];
}

/**
 * A dependency relationship between two issues
 */
export interface IssueDependency {
  /** Issue ID that must be completed first */
  from: string;
  /** Issue ID that depends on the 'from' issue */
  to: string;
  /** Type of dependency */
  type: 'blocks' | 'conflicts' | 'enables';
  /** AI-generated explanation of why this dependency exists */
  reason: string;
}

/**
 * A group of issues that can be worked on in parallel
 */
export interface ParallelGroup {
  /** Name/description of this workstream */
  name: string;
  /** Issue IDs in this group */
  issueIds: string[];
}

/**
 * Result of AI dependency analysis
 */
export interface DependencyAnalysis {
  /** Direct dependencies between issues */
  dependencies: IssueDependency[];
  /** Groups of issues that can be parallelized */
  parallelGroups: ParallelGroup[];
  /** AI-generated summary of the analysis */
  summary: string;
  /** Recommended execution order */
  executionOrder: string[];
  /** AI-generated markdown section with rover fix commands */
  commandsMarkdown?: string;
}

/**
 * A complete work plan
 */
export interface WorkPlan {
  /** ISO timestamp of generation */
  generatedAt: string;
  /** Issues included in this plan */
  issues: ApprovedIssue[];
  /** Dependency analysis result */
  analysis: DependencyAnalysis;
  /** Generated Mermaid diagram */
  mermaidDiagram: string;
}
