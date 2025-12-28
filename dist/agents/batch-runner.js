import { getAgentIds, getAgent } from './definitions/index.js';
import { runScanner } from './scanner.js';
import { runChecker } from './checker.js';
import { runArbitrator } from './arbitrator.js';
import { getExistingIssueSummaries } from '../storage/issues.js';
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
function isTransientError(error) {
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
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/**
 * Run a single agent through the full pipeline (scan -> check -> save)
 */
async function runSingleAgent(agentId, targetPath, onProgress, retryCount = 0) {
    const agent = getAgent(agentId);
    if (!agent) {
        throw new Error(`Unknown agent: ${agentId}`);
    }
    try {
        // Get existing issues for deduplication
        const existingIssues = await getExistingIssueSummaries(targetPath);
        // Phase 1: Scan
        onProgress?.({ phase: 'scanning', message: `[${agent.name}] Scanning...` });
        const scanResult = await runScanner({
            targetPath,
            agentId,
            existingIssues,
            onProgress: (msg) => onProgress?.({ phase: 'scanning', message: `[${agent.name}] ${msg}` })
        });
        // If no issues found, skip checking
        if (scanResult.issues.length === 0) {
            return {
                agentId,
                agentName: agent.name,
                scanResult,
                checkerResult: { approvedIds: [], rejectedIds: [], durationMs: 0 },
                arbitratorResult: {
                    approvedIssues: [],
                    rejectedIssues: [],
                    ticketsCreated: []
                }
            };
        }
        // Phase 2: Check
        const totalIssues = scanResult.issues.length;
        let issuesChecked = 0;
        onProgress?.({
            phase: 'checking',
            message: `[${agent.name}] Checking issues...`,
            issuesChecked: 0,
            issuesToCheck: totalIssues
        });
        const checkerResult = await runChecker({
            targetPath,
            agentId,
            issues: scanResult.issues,
            onProgress: (batchCount, completed) => {
                if (completed) {
                    issuesChecked += batchCount;
                    onProgress?.({
                        phase: 'checking',
                        message: `[${agent.name}] Checking issues...`,
                        issuesChecked,
                        issuesToCheck: totalIssues
                    });
                }
            }
        });
        // Phase 3: Save approved issues
        onProgress?.({ phase: 'saving', message: `[${agent.name}] Saving approved issues...` });
        const arbitratorResult = await runArbitrator({
            targetPath,
            candidateIssues: scanResult.issues,
            approvedIds: checkerResult.approvedIds
        });
        return {
            agentId,
            agentName: agent.name,
            scanResult,
            checkerResult,
            arbitratorResult
        };
    }
    catch (error) {
        // Retry on transient errors
        if (isTransientError(error) && retryCount < MAX_RETRIES) {
            onProgress?.({ phase: 'scanning', message: `[${agent.name}] Transient error, retrying (${retryCount + 1}/${MAX_RETRIES})...` });
            await sleep(RETRY_DELAY_MS * (retryCount + 1));
            return runSingleAgent(agentId, targetPath, onProgress, retryCount + 1);
        }
        throw error;
    }
}
/**
 * Orchestrates batch scanning of a codebase using multiple agents with a work queue pattern.
 * Each agent runs through the full pipeline: scan -> check -> save.
 *
 * @param targetPath - Absolute path to the codebase directory to scan
 * @param agentIds - List of specific agent IDs to run, or 'all' to run all registered agents
 * @param options - Configuration options for batch execution
 * @param options.concurrency - Maximum number of agents to run in parallel (default: 8)
 * @param options.onProgress - Callback invoked with progress updates during scan/vote/arbitrate phases
 * @param options.onAgentComplete - Callback invoked when each agent completes (success or failure)
 * @returns Aggregated results including individual agent results and summary statistics
 *
 * @remarks
 * - Uses a work queue pattern where multiple workers pull agents from a shared queue
 * - Failed agents are tracked via the `error` field in AgentResult and `failedAgents` count
 * - Transient errors (network issues, JSON parsing) are retried up to MAX_RETRIES times
 */
export async function runAgentsBatched(targetPath, agentIds, options = {}) {
    const { concurrency = DEFAULT_CONCURRENCY, onProgress, onAgentComplete, skipAgentIds = [], onStateChange } = options;
    // Resolve agent IDs and filter out skipped ones
    const resolvedAgentIds = agentIds === 'all' ? getAgentIds() : agentIds;
    const skipSet = new Set(skipAgentIds);
    const agentsToRun = resolvedAgentIds.filter(id => !skipSet.has(id));
    const queue = [...agentsToRun];
    const totalAgents = resolvedAgentIds.length; // Total includes skipped for progress display
    const skippedCount = skipAgentIds.length;
    const startTime = Date.now();
    const agentResults = [];
    let completedCount = skippedCount; // Start from skipped count for accurate progress
    // Worker function - pulls from queue until empty
    async function processAgentFromQueue() {
        while (queue.length > 0) {
            const agentId = queue.shift();
            if (!agentId)
                break; // Queue exhausted by another worker
            const agent = getAgent(agentId);
            // Notify state change: running
            onStateChange?.(agentId, 'running');
            const progressCallback = (progress) => {
                onProgress?.({
                    phase: progress.phase,
                    agentId,
                    agentName: agent?.name ?? agentId,
                    completedCount,
                    totalAgents,
                    message: progress.message,
                    issuesChecked: progress.issuesChecked,
                    issuesToCheck: progress.issuesToCheck
                });
            };
            try {
                const result = await runSingleAgent(agentId, targetPath, progressCallback);
                agentResults.push(result);
                completedCount++;
                // Notify state change: completed
                onStateChange?.(agentId, 'completed', result);
                onAgentComplete?.(result);
            }
            catch (error) {
                // Track the error in the result so callers can distinguish failures from empty results
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.error(`Error running agent ${agentId}:`, error);
                const failedResult = {
                    agentId,
                    agentName: agent?.name ?? agentId,
                    scanResult: { issues: [], durationMs: 0, filesScanned: 0 },
                    checkerResult: { approvedIds: [], rejectedIds: [], durationMs: 0 },
                    arbitratorResult: { approvedIssues: [], rejectedIssues: [], ticketsCreated: [] },
                    error: errorMessage
                };
                agentResults.push(failedResult);
                completedCount++;
                // Notify state change: error
                onStateChange?.(agentId, 'error', failedResult);
                onAgentComplete?.(failedResult);
            }
        }
    }
    // Spawn workers (limit to actual queue size if smaller than concurrency)
    const workerCount = Math.min(concurrency, agentsToRun.length);
    const workers = Array.from({ length: workerCount }, () => processAgentFromQueue());
    await Promise.all(workers);
    // Aggregate results in single pass
    const aggregated = agentResults.reduce((acc, result) => ({
        totalCandidateIssues: acc.totalCandidateIssues + result.scanResult.issues.length,
        totalApprovedIssues: acc.totalApprovedIssues + result.arbitratorResult.approvedIssues.length,
        totalRejectedIssues: acc.totalRejectedIssues + result.arbitratorResult.rejectedIssues.length,
        totalTickets: acc.totalTickets + result.arbitratorResult.ticketsCreated.length,
        failedAgents: acc.failedAgents + (result.error !== undefined ? 1 : 0)
    }), { totalCandidateIssues: 0, totalApprovedIssues: 0, totalRejectedIssues: 0, totalTickets: 0, failedAgents: 0 });
    return {
        agentResults,
        totalCandidateIssues: aggregated.totalCandidateIssues,
        totalApprovedIssues: aggregated.totalApprovedIssues,
        totalRejectedIssues: aggregated.totalRejectedIssues,
        totalTickets: aggregated.totalTickets,
        totalDurationMs: Date.now() - startTime,
        failedAgents: aggregated.failedAgents,
        skippedAgents: skippedCount
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
export function getAgentsByCategory() {
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
