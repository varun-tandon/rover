import type { CandidateIssue, Vote, ApprovedIssue } from '../types/index.js';
import type { ScannerResult, VoterResult, ArbitratorResult } from './types.js';
import { getAgentIds, getAgent } from './definitions/index.js';
import { runScanner } from './scanner.js';
import { runVotersInParallel } from './voter.js';
import { runArbitrator } from './arbitrator.js';
import { getExistingIssueSummaries } from '../storage/issues.js';

/**
 * Progress update during batch agent execution.
 * Emitted via the onProgress callback to track the current state of batch processing.
 */
export interface BatchProgress {
  /** Current phase of the pipeline for this agent */
  phase: 'scanning' | 'voting' | 'arbitrating';
  /** Unique identifier of the agent currently being processed */
  agentId: string;
  /** Human-readable name of the agent */
  agentName: string;
  /** Number of agents that have completed processing */
  completedCount: number;
  /** Total number of agents in this batch run */
  totalAgents: number;
  /** Human-readable status message describing current activity */
  message: string;
}

/**
 * Complete result from running a single agent through the scan-vote-arbitrate pipeline.
 * Contains all outputs from each phase plus metadata about the agent.
 */
export interface AgentResult {
  /** Unique identifier of the agent */
  agentId: string;
  /** Human-readable name of the agent */
  agentName: string;
  /** Results from the scanning phase (candidate issues found) */
  scanResult: ScannerResult;
  /** Results from each voter (votes on candidate issues) */
  voterResults: VoterResult[];
  /** Final arbitration results (approved/rejected issues, tickets created) */
  arbitratorResult: ArbitratorResult;
  /** Error message if the agent failed during execution. When set, other results may be empty. */
  error?: string;
}

/**
 * Aggregated results from running multiple agents in batch mode.
 * Contains individual agent results plus summary statistics across all agents.
 */
export interface BatchRunResult {
  /** Results from each individual agent */
  agentResults: AgentResult[];
  /** Total number of candidate issues found across all agents */
  totalCandidateIssues: number;
  /** Total number of issues that passed voting and were approved */
  totalApprovedIssues: number;
  /** Total number of issues that were rejected by voters */
  totalRejectedIssues: number;
  /** Total number of ticket files created */
  totalTickets: number;
  /** Total elapsed time for the batch run in milliseconds */
  totalDurationMs: number;
  /** Total estimated cost in USD for all API calls */
  totalCostUsd: number;
  /** Number of agents that failed during execution */
  failedAgents: number;
}

// MAX_RETRIES = 2: Balances reliability with API costs. Testing showed transient errors
// (JSON parsing, network issues) typically resolve within 2 retries.
const MAX_RETRIES = 2;

// RETRY_DELAY_MS = 1000: Base delay for exponential backoff (multiplied by retry count).
// 1 second base avoids overwhelming the API while keeping total retry time reasonable.
const RETRY_DELAY_MS = 1000;

// DEFAULT_CONCURRENCY = 4: Balances throughput with API rate limits and cost control.
// Higher values risk rate limiting; lower values extend total batch time unnecessarily.
const DEFAULT_CONCURRENCY = 4;

/**
 * Check if an error is transient and worth retrying
 */
function isTransientError(error: unknown): boolean {
  if (error instanceof SyntaxError) {
    // JSON parsing errors from SDK are often transient
    return true;
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('unterminated string') ||
           msg.includes('json') ||
           msg.includes('econnreset') ||
           msg.includes('timeout');
  }
  return false;
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Run a single agent through the full pipeline (scan -> vote -> arbitrate)
 */
async function runSingleAgent(
  agentId: string,
  targetPath: string,
  onProgress?: (message: string) => void,
  retryCount = 0
): Promise<AgentResult> {
  const agent = getAgent(agentId);
  if (!agent) {
    throw new Error(`Unknown agent: ${agentId}`);
  }

  try {
    // Get existing issues for deduplication
    const existingIssues = await getExistingIssueSummaries(targetPath);

    // Phase 1: Scan
    onProgress?.(`[${agent.name}] Scanning...`);
    const scanResult = await runScanner({
      targetPath,
      agentId,
      existingIssues,
      onProgress: (msg) => onProgress?.(`[${agent.name}] ${msg}`)
    });

    // If no issues found, skip voting
    if (scanResult.issues.length === 0) {
      return {
        agentId,
        agentName: agent.name,
        scanResult,
        voterResults: [],
        arbitratorResult: {
          approvedIssues: [],
          rejectedIssues: [],
          ticketsCreated: []
        }
      };
    }

    // Phase 2: Vote
    onProgress?.(`[${agent.name}] Voting on ${scanResult.issues.length} issues...`);
    const voterResults = await runVotersInParallel(
      targetPath,
      agentId,
      scanResult.issues,
      3,
      (voterId, issueId, completed) => {
        if (completed) {
          onProgress?.(`[${agent.name}] ${voterId} finished voting on ${issueId}`);
        } else {
          onProgress?.(`[${agent.name}] ${voterId} voting on ${issueId}...`);
        }
      }
    );

    // Phase 3: Arbitrate
    onProgress?.(`[${agent.name}] Arbitrating...`);
    const allVotes = voterResults.flatMap(r => r.votes);
    const arbitratorResult = await runArbitrator({
      targetPath,
      candidateIssues: scanResult.issues,
      votes: allVotes,
      minimumVotes: 2
    });

    return {
      agentId,
      agentName: agent.name,
      scanResult,
      voterResults,
      arbitratorResult
    };
  } catch (error) {
    // Retry on transient errors
    if (isTransientError(error) && retryCount < MAX_RETRIES) {
      onProgress?.(`[${agent.name}] Transient error, retrying (${retryCount + 1}/${MAX_RETRIES})...`);
      await sleep(RETRY_DELAY_MS * (retryCount + 1));
      return runSingleAgent(agentId, targetPath, onProgress, retryCount + 1);
    }
    throw error;
  }
}

/**
 * Orchestrates batch scanning of a codebase using multiple agents with a work queue pattern.
 * Each agent runs through the full pipeline: scan -> vote -> arbitrate.
 *
 * @param targetPath - Absolute path to the codebase directory to scan
 * @param agentIds - List of specific agent IDs to run, or 'all' to run all registered agents
 * @param options - Configuration options for batch execution
 * @param options.concurrency - Maximum number of agents to run in parallel (default: 4)
 * @param options.onProgress - Callback invoked with progress updates during scan/vote/arbitrate phases
 * @param options.onAgentComplete - Callback invoked when each agent completes (success or failure)
 * @returns Aggregated results including individual agent results and summary statistics
 *
 * @remarks
 * - Uses a work queue pattern where multiple workers pull agents from a shared queue
 * - Failed agents are tracked via the `error` field in AgentResult and `failedAgents` count
 * - Transient errors (network issues, JSON parsing) are retried up to MAX_RETRIES times
 */
export async function runAgentsBatched(
  targetPath: string,
  agentIds: string[] | 'all',
  options: {
    concurrency?: number;
    onProgress?: (progress: BatchProgress) => void;
    onAgentComplete?: (result: AgentResult) => void;
  } = {}
): Promise<BatchRunResult> {
  const { concurrency = DEFAULT_CONCURRENCY, onProgress, onAgentComplete } = options;

  // Resolve agent IDs and create work queue
  const resolvedAgentIds = agentIds === 'all' ? getAgentIds() : agentIds;
  const queue = [...resolvedAgentIds];
  const totalAgents = resolvedAgentIds.length;

  const startTime = Date.now();
  const agentResults: AgentResult[] = [];
  let completedCount = 0;

  // Worker function - pulls from queue until empty
  async function processAgentFromQueue(): Promise<void> {
    while (queue.length > 0) {
      const agentId = queue.shift();
      if (!agentId) break; // Queue exhausted by another worker

      const agent = getAgent(agentId);

      const progressCallback = (message: string) => {
        onProgress?.({
          phase: 'scanning',
          agentId,
          agentName: agent?.name ?? agentId,
          completedCount,
          totalAgents,
          message
        });
      };

      try {
        const result = await runSingleAgent(agentId, targetPath, progressCallback);
        agentResults.push(result);
        completedCount++;
        onAgentComplete?.(result);
      } catch (error) {
        // Track the error in the result so callers can distinguish failures from empty results
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Error running agent ${agentId}:`, error);
        const failedResult: AgentResult = {
          agentId,
          agentName: agent?.name ?? agentId,
          scanResult: { issues: [], durationMs: 0, filesScanned: 0, costUsd: 0 },
          voterResults: [],
          arbitratorResult: { approvedIssues: [], rejectedIssues: [], ticketsCreated: [] },
          error: errorMessage
        };
        agentResults.push(failedResult);
        completedCount++;
        onAgentComplete?.(failedResult);
      }
    }
  }

  // Spawn workers (limit to actual queue size if smaller than concurrency)
  const workerCount = Math.min(concurrency, totalAgents);
  const workers = Array.from({ length: workerCount }, () => processAgentFromQueue());
  await Promise.all(workers);

  // Aggregate results in single pass
  const aggregated = agentResults.reduce(
    (acc, result) => ({
      totalCandidateIssues: acc.totalCandidateIssues + result.scanResult.issues.length,
      totalApprovedIssues: acc.totalApprovedIssues + result.arbitratorResult.approvedIssues.length,
      totalRejectedIssues: acc.totalRejectedIssues + result.arbitratorResult.rejectedIssues.length,
      totalTickets: acc.totalTickets + result.arbitratorResult.ticketsCreated.length,
      totalCostUsd: acc.totalCostUsd + result.scanResult.costUsd +
        result.voterResults.reduce((sum, vr) => sum + vr.costUsd, 0),
      failedAgents: acc.failedAgents + (result.error !== undefined ? 1 : 0)
    }),
    { totalCandidateIssues: 0, totalApprovedIssues: 0, totalRejectedIssues: 0, totalTickets: 0, totalCostUsd: 0, failedAgents: 0 }
  );

  return {
    agentResults,
    totalCandidateIssues: aggregated.totalCandidateIssues,
    totalApprovedIssues: aggregated.totalApprovedIssues,
    totalRejectedIssues: aggregated.totalRejectedIssues,
    totalTickets: aggregated.totalTickets,
    totalDurationMs: Date.now() - startTime,
    totalCostUsd: aggregated.totalCostUsd,
    failedAgents: aggregated.failedAgents
  };
}

/**
 * Get agent IDs grouped by category for UI display purposes.
 *
 * Returns a mapping of human-readable category names to arrays of agent IDs.
 * Useful for organizing agents in the CLI help output or selection UI.
 *
 * @returns Record mapping category names to agent ID arrays
 *
 * Categories:
 * - **Architecture**: Code structure, dependencies, abstraction issues
 * - **React**: React-specific patterns and anti-patterns
 * - **Clarity**: Naming, documentation, code obviousness
 * - **Consistency**: Style and pattern consistency
 * - **Bugs**: Logic errors, exception handling issues
 * - **Security**: Security vulnerabilities, config exposure
 *
 * @example
 * const categories = getAgentsByCategory();
 * // { 'Architecture': ['critical-path-scout', ...], 'React': [...], ... }
 */
export function getAgentsByCategory(): Record<string, string[]> {
  return {
    'Architecture': [
      'critical-path-scout',
      'depth-gauge',
      'generalizer',
      'cohesion-analyzer',
      'layer-petrifier',
      'boilerplate-buster'
    ],
    'React': [
      'state-deriver',
      'legacy-react-purist'
    ],
    'Clarity': [
      'obviousness-auditor',
      'why-asker',
      'naming-renovator',
      'interface-documenter'
    ],
    'Consistency': [
      'consistency-cop'
    ],
    'Bugs': [
      'exception-auditor',
      'logic-detective'
    ],
    'Security': [
      'security-sweeper',
      'config-cleaner'
    ]
  };
}
