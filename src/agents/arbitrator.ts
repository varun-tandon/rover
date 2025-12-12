import type { CandidateIssue, Vote, ApprovedIssue } from '../types/index.js';
import type { ArbitratorResult, ArbitratorOptions } from './types.js';
import { addApprovedIssues } from '../storage/issues.js';
import { createTicketFiles } from '../storage/tickets.js';

/**
 * Group votes by issue ID
 */
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
 * Count approvals for an issue
 */
function countApprovals(votes: Vote[]): number {
  return votes.filter(v => v.approve).length;
}

/**
 * Run the arbitrator to filter issues and create tickets
 *
 * The arbitrator:
 * 1. Collects all votes for each candidate issue
 * 2. Filters to only issues with majority approval (default: 2/3 votes)
 * 3. Creates ticket files for approved issues
 * 4. Updates the issue store
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

/**
 * Get a summary of the arbitration result
 */
export function getArbitrationSummary(result: ArbitratorResult): string {
  const { approvedIssues, rejectedIssues, ticketsCreated } = result;

  const lines: string[] = [];

  lines.push(`Arbitration Complete`);
  lines.push(`-------------------`);
  lines.push(`Total candidates: ${approvedIssues.length + rejectedIssues.length}`);
  lines.push(`Approved: ${approvedIssues.length}`);
  lines.push(`Rejected: ${rejectedIssues.length}`);
  lines.push(`Tickets created: ${ticketsCreated.length}`);

  if (approvedIssues.length > 0) {
    lines.push('');
    lines.push('Approved Issues:');
    for (const issue of approvedIssues) {
      const voteCount = issue.votes.filter(v => v.approve).length;
      lines.push(`  - [${issue.severity.toUpperCase()}] ${issue.title} (${voteCount}/3 votes)`);
    }
  }

  if (rejectedIssues.length > 0) {
    lines.push('');
    lines.push('Rejected Issues:');
    for (const issue of rejectedIssues) {
      lines.push(`  - ${issue.title}`);
    }
  }

  return lines.join('\n');
}
