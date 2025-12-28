/**
 * Issue grouping logic for batch fixing.
 * Groups related issues into batches that can be fixed together in a single branch/PR.
 */
import { dirname } from 'node:path';
/**
 * Get the top-level directory of a file path.
 * e.g., "src/components/Button.tsx" -> "src/components"
 */
function getDirectory(filePath) {
    return dirname(filePath);
}
/**
 * Get a short directory name for batch naming.
 * e.g., "src/components/ui" -> "components-ui"
 */
function getShortDirName(dir) {
    const parts = dir.split('/').filter(p => p && p !== 'src');
    return parts.slice(0, 2).join('-') || 'root';
}
/**
 * Estimate the scope of a fix based on the issue.
 * Returns a rough estimate of lines that might change.
 */
function estimateScope(issue) {
    // Use code snippet length as a proxy
    if (issue.codeSnippet) {
        const lines = issue.codeSnippet.split('\n').length;
        // Assume fix is roughly 1.5x the snippet size
        return Math.ceil(lines * 1.5);
    }
    // Use line range if available
    if (issue.lineRange) {
        return (issue.lineRange.end - issue.lineRange.start + 1) * 2;
    }
    // Default estimate based on severity
    const severityEstimates = {
        low: 5,
        medium: 15,
        high: 30,
        critical: 50
    };
    return severityEstimates[issue.severity];
}
/**
 * Group issues by a key function.
 */
function groupBy(items, keyFn) {
    const groups = new Map();
    for (const item of items) {
        const key = keyFn(item);
        const existing = groups.get(key);
        if (existing) {
            existing.push(item);
        }
        else {
            groups.set(key, [item]);
        }
    }
    return groups;
}
/**
 * Group issues into batches for efficient fixing.
 *
 * Grouping heuristics (in priority order):
 * 1. Same directory - issues in the same module/area
 * 2. Same agent - same type of problem (similar fixes)
 * 3. Low severity - batch cleanup work
 * 4. Small scope - quick wins that can be done together
 *
 * @param issues - All approved issues to group
 * @param options - Grouping options
 * @returns Grouped batches and individual issues
 */
export function groupIssuesForBatching(issues, options = {}) {
    const { minBatchSize = 2, maxBatchSize = 10, maxBatchScope = 200, batchLowSeverity = true } = options;
    const batches = [];
    const usedIds = new Set();
    let batchCounter = 0;
    /**
     * Try to create a batch from a group of issues.
     * Respects max batch size and scope limits.
     */
    function tryCreateBatch(candidates, name, reason) {
        // Filter out already-used issues
        const available = candidates.filter(i => !usedIds.has(i.id));
        if (available.length < minBatchSize)
            return;
        // Sort by scope (smallest first) to pack more issues
        const sorted = [...available].sort((a, b) => estimateScope(a) - estimateScope(b));
        // Build batch respecting limits
        const batchIssues = [];
        let totalScope = 0;
        for (const issue of sorted) {
            const scope = estimateScope(issue);
            if (batchIssues.length < maxBatchSize &&
                totalScope + scope <= maxBatchScope) {
                batchIssues.push(issue);
                totalScope += scope;
            }
        }
        if (batchIssues.length >= minBatchSize) {
            for (const issue of batchIssues) {
                usedIds.add(issue.id);
            }
            batches.push({
                id: `batch-${batchCounter++}`,
                name,
                reason,
                issues: batchIssues
            });
        }
    }
    // Strategy 1: Group by directory
    const byDir = groupBy(issues, (i) => getDirectory(i.filePath));
    for (const [dir, dirIssues] of byDir) {
        if (dirIssues.length >= minBatchSize) {
            const shortName = getShortDirName(dir);
            tryCreateBatch(dirIssues, shortName, `Same directory: ${dir}`);
        }
    }
    // Strategy 2: Group by agent (same type of problem)
    const remaining1 = issues.filter(i => !usedIds.has(i.id));
    const byAgent = groupBy(remaining1, (i) => i.agentId);
    for (const [agentId, agentIssues] of byAgent) {
        if (agentIssues.length >= minBatchSize) {
            tryCreateBatch(agentIssues, agentId, `Same agent: ${agentId}`);
        }
    }
    // Strategy 3: Batch all remaining low severity issues
    if (batchLowSeverity) {
        const remaining2 = issues.filter(i => !usedIds.has(i.id));
        const lowSeverity = remaining2.filter(i => i.severity === 'low');
        if (lowSeverity.length >= minBatchSize) {
            tryCreateBatch(lowSeverity, 'cleanup', 'Low severity cleanup');
        }
    }
    // Strategy 4: Batch small-scope issues together
    const remaining3 = issues.filter(i => !usedIds.has(i.id));
    const smallScope = remaining3.filter(i => estimateScope(i) <= 10);
    if (smallScope.length >= minBatchSize) {
        tryCreateBatch(smallScope, 'quick-fixes', 'Small scope quick fixes');
    }
    // Everything else is individual
    const individual = issues.filter(i => !usedIds.has(i.id));
    return { batches, individual };
}
/**
 * Format a batch for display in the CLI.
 */
export function formatBatchForDisplay(batch, index) {
    const issueIds = batch.issues.map(i => i.id.split('-').pop()).join(', ');
    const totalScope = batch.issues.reduce((sum, i) => sum + estimateScope(i), 0);
    return `[${index + 1}] fix/${batch.name}: ${batch.issues.length} issues (${issueIds})
     Reason: ${batch.reason}
     Est. scope: ~${totalScope} lines`;
}
/**
 * Get summary statistics for a grouping result.
 */
export function getGroupingStats(result) {
    const issuesInBatches = result.batches.reduce((sum, b) => sum + b.issues.length, 0);
    return {
        totalBatches: result.batches.length,
        issuesInBatches,
        individualIssues: result.individual.length,
        // One PR per batch + one per individual issue
        estimatedPRs: result.batches.length + result.individual.length
    };
}
