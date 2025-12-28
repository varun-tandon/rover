import { addApprovedIssues } from '../storage/issues.js';
import { createTicketFiles } from '../storage/tickets.js';
/**
 * Save approved issues and create tickets.
 *
 * The arbitrator performs the final stage of the scan pipeline:
 * 1. Filters candidate issues to only those approved by the checker
 * 2. Creates markdown ticket files for approved issues (organized by severity)
 * 3. Persists approved issues to the issue store for deduplication
 *
 * @param options - Configuration for arbitration
 * @param options.targetPath - Absolute path to the codebase (for ticket storage in .rover/)
 * @param options.candidateIssues - All candidate issues detected by the scanner
 * @param options.approvedIds - IDs of issues approved by the checker
 * @returns Arbitration results including approved/rejected issues and created ticket paths
 */
export async function runArbitrator(options) {
    const { targetPath, candidateIssues, approvedIds } = options;
    const approvedIdSet = new Set(approvedIds);
    const approvedIssues = [];
    const rejectedIssues = [];
    const now = new Date().toISOString();
    for (const issue of candidateIssues) {
        if (approvedIdSet.has(issue.id)) {
            // Issue is approved
            const approvedIssue = {
                ...issue,
                approvedAt: now,
                ticketPath: '' // Will be set when ticket is created
            };
            approvedIssues.push(approvedIssue);
        }
        else {
            // Issue is rejected
            rejectedIssues.push(issue);
        }
    }
    // Create ticket files for approved issues (returns updated issues with ticketPath set)
    const ticketResult = await createTicketFiles(targetPath, approvedIssues);
    // Save approved issues to the store (use the updated issues with ticketPath populated)
    if (ticketResult.issues.length > 0) {
        await addApprovedIssues(targetPath, ticketResult.issues);
    }
    return {
        approvedIssues: ticketResult.issues,
        rejectedIssues,
        ticketsCreated: ticketResult.paths
    };
}
export function getArbitrationSummary(result) {
    const { approvedIssues, rejectedIssues, ticketsCreated } = result;
    const reportLines = [];
    reportLines.push(`Summary`);
    reportLines.push(`-------`);
    reportLines.push(`Total candidates: ${approvedIssues.length + rejectedIssues.length}`);
    reportLines.push(`Approved: ${approvedIssues.length}`);
    reportLines.push(`Rejected: ${rejectedIssues.length}`);
    reportLines.push(`Tickets created: ${ticketsCreated.length}`);
    if (approvedIssues.length > 0) {
        reportLines.push('');
        reportLines.push('Approved Issues:');
        for (const issue of approvedIssues) {
            reportLines.push(`  - [${issue.severity.toUpperCase()}] ${issue.title}`);
        }
    }
    if (rejectedIssues.length > 0) {
        reportLines.push('');
        reportLines.push('Rejected Issues:');
        for (const issue of rejectedIssues) {
            reportLines.push(`  - ${issue.title}`);
        }
    }
    return reportLines.join('\n');
}
