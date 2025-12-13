import type { CandidateIssue, Vote, ApprovedIssue } from '../types/index.js';
import type { ArbitratorResult, ArbitratorOptions } from './types.js';
import { addApprovedIssues } from '../storage/issues.js';
import { createTicketFiles } from '../storage/tickets.js';
import { countApprovals } from '../utils/votes.js';

function groupVotesByIssue(votes: Vote[]): Map<string, Vote[]> {
  const grouped = new Map<string, Vote[]>();

  for (const vote of votes) {
    const existing = grouped.get(vote.issueId) ?? [];
    existing.push(vote);
    grouped.set(vote.issueId, existing);
  }

  return grouped;
}


/**
 * Run the arbitrator to filter issues by vote count and create tickets.
 *
 * The arbitrator performs the final stage of the scan pipeline:
 * 1. Collects all votes for each candidate issue
 * 2. Filters to only issues with sufficient approval votes (default: 2/3 majority)
 * 3. Creates markdown ticket files for approved issues (organized by severity)
 * 4. Persists approved issues to the issue store for deduplication
 *
 * @param options - Configuration for arbitration
 * @param options.targetPath - Absolute path to the codebase (for ticket storage in .rover/)
 * @param options.candidateIssues - All candidate issues detected by the scanner
 * @param options.votes - All votes from all voters on the candidate issues
 * @param options.minimumVotes - Minimum approval votes required (default: 2 for 3 voters)
 * @returns Arbitration results including approved/rejected issues and created ticket paths
 */
export async function runArbitrator(options: ArbitratorOptions): Promise<ArbitratorResult> {
  const {
    targetPath,
    candidateIssues,
    votes,
    minimumVotes = 2
  } = options;

  const votesByIssue = groupVotesByIssue(votes);
  const approvedIssues: ApprovedIssue[] = [];
  const rejectedIssues: CandidateIssue[] = [];

  const now = new Date().toISOString();

  for (const issue of candidateIssues) {
    const issueVotes = votesByIssue.get(issue.id) ?? [];
    const approvalCount = countApprovals(issueVotes);

    if (approvalCount >= minimumVotes) {
      // Issue is approved
      const approvedIssue: ApprovedIssue = {
        ...issue,
        votes: issueVotes,
        approvedAt: now,
        ticketPath: '' // Will be set when ticket is created
      };
      approvedIssues.push(approvedIssue);
    } else {
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

export function getArbitrationSummary(result: ArbitratorResult): string {
  const { approvedIssues, rejectedIssues, ticketsCreated } = result;

  const reportLines: string[] = [];

  reportLines.push(`Arbitration Complete`);
  reportLines.push(`-------------------`);
  reportLines.push(`Total candidates: ${approvedIssues.length + rejectedIssues.length}`);
  reportLines.push(`Approved: ${approvedIssues.length}`);
  reportLines.push(`Rejected: ${rejectedIssues.length}`);
  reportLines.push(`Tickets created: ${ticketsCreated.length}`);

  if (approvedIssues.length > 0) {
    reportLines.push('');
    reportLines.push('Approved Issues:');
    for (const issue of approvedIssues) {
      const voteCount = countApprovals(issue.votes);
      reportLines.push(`  - [${issue.severity.toUpperCase()}] ${issue.title} (${voteCount}/3 votes)`);
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
