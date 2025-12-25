/**
 * Consolidator agent for merging related issues into a single comprehensive issue.
 * Uses an LLM to analyze the issues and produce a merged version.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { ApprovedIssue, IssueCluster, IssueSeverity } from '../types/index.js';
import { extractTicketId } from '../storage/tickets.js';

/**
 * Options for running the consolidator
 */
export interface ConsolidatorOptions {
  /** Target directory containing the code */
  targetPath: string;
  /** Cluster of issues to consolidate */
  cluster: IssueCluster;
  /** Callback for progress updates */
  onProgress?: (message: string) => void;
}

/**
 * Result from the consolidator
 */
export interface ConsolidatorResult {
  /** The merged issue (without ticketPath, to be set later) */
  consolidatedIssue: Omit<ApprovedIssue, 'ticketPath'>;
  /** Original issue IDs that were consolidated */
  originalIssueIds: string[];
  /** Duration in milliseconds */
  durationMs: number;
  /** Cost in USD */
  costUsd: number;
}

/**
 * Format an issue for inclusion in the prompt
 */
function formatIssueForPrompt(issue: ApprovedIssue): string {
  const ticketId = extractTicketId(issue.ticketPath) ?? issue.id;
  const lines = [
    `### ${ticketId}: ${issue.title}`,
    `- **Severity**: ${issue.severity}`,
    `- **Category**: ${issue.category}`,
    `- **File**: ${issue.filePath}${issue.lineRange ? `:${issue.lineRange.start}-${issue.lineRange.end}` : ''}`,
    `- **Description**: ${issue.description}`,
    `- **Recommendation**: ${issue.recommendation}`
  ];

  if (issue.codeSnippet) {
    lines.push(`- **Code**:\n\`\`\`\n${issue.codeSnippet}\n\`\`\``);
  }

  return lines.join('\n');
}

/**
 * Get the highest severity from a list of issues
 */
function getHighestSeverity(issues: ApprovedIssue[]): IssueSeverity {
  const severityOrder: IssueSeverity[] = ['critical', 'high', 'medium', 'low'];

  for (const severity of severityOrder) {
    if (issues.some(i => i.severity === severity)) {
      return severity;
    }
  }

  return 'medium';
}

/**
 * Merge votes from multiple issues
 */
function mergeVotes(issues: ApprovedIssue[]): ApprovedIssue['votes'] {
  const allVotes = issues.flatMap(i => i.votes);
  // Deduplicate by voterId, keeping the first vote from each voter
  const seenVoters = new Set<string>();
  return allVotes.filter(vote => {
    if (seenVoters.has(vote.voterId)) return false;
    seenVoters.add(vote.voterId);
    return true;
  });
}

/**
 * Run the consolidator agent to merge a cluster of related issues.
 */
export async function runConsolidator(options: ConsolidatorOptions): Promise<ConsolidatorResult> {
  const { targetPath, cluster, onProgress } = options;

  const startTime = Date.now();
  let totalCost = 0;

  onProgress?.(`Consolidating ${cluster.issues.length} issues: ${cluster.reason}`);

  // Extract original ticket IDs
  const originalIssueIds = cluster.issues.map(issue => {
    const ticketId = extractTicketId(issue.ticketPath);
    return ticketId ?? issue.id;
  });

  // Collect unique file paths from all issues
  const uniqueFilePaths = [...new Set(cluster.issues.map(i => i.filePath))];

  const prompt = `You are consolidating related code quality issues into a single comprehensive issue.

## ISSUES TO CONSOLIDATE

${cluster.issues.map(formatIssueForPrompt).join('\n\n---\n\n')}

## CLUSTERING REASON
${cluster.reason}

## INSTRUCTIONS

1. Read the affected files to understand the full context:
${uniqueFilePaths.map(fp => `   - ${fp}`).join('\n')}

2. Create ONE consolidated issue that comprehensively covers all the related problems.

3. Rules for merging:
   - Combine descriptions to be comprehensive but not redundant
   - Merge recommendations into a prioritized, actionable list
   - Choose the most representative file as the primary filePath
   - Include line ranges from all issues if they're in the same file

4. Return ONLY valid JSON with this structure:

{
  "title": "Consolidated title that captures the common theme",
  "description": "Comprehensive description covering all related issues. Mention each specific problem.",
  "category": "Most appropriate category",
  "recommendation": "Merged recommendations as a numbered list",
  "primaryFilePath": "The most representative file path",
  "lineRange": { "start": number, "end": number } | null,
  "codeSnippet": "Most relevant code snippet (optional)"
}

Return ONLY the JSON object. No markdown, no explanations.`;

  try {
    const agentQuery = query({
      prompt,
      options: {
        model: 'claude-sonnet-4-5-20250929',
        allowedTools: ['Read'],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        cwd: targetPath,
        maxTurns: 20
      }
    });

    let resultText = '';

    for await (const message of agentQuery) {
      if (message.type === 'result' && message.subtype === 'success') {
        resultText = message.result;
        totalCost = message.total_cost_usd;
      }

      // Progress updates
      if (message.type === 'assistant') {
        const content = message.message.content;
        for (const block of content) {
          if (block.type === 'tool_use' && block.name === 'Read') {
            onProgress?.(`Reading: ${(block.input as { file_path?: string }).file_path ?? 'unknown file'}`);
          }
        }
      }
    }

    // Parse the result
    if (!resultText) {
      throw new Error('No result from consolidator agent');
    }

    const jsonMatch = resultText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Failed to parse consolidator response as JSON');
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      title?: string;
      description?: string;
      category?: string;
      recommendation?: string;
      primaryFilePath?: string;
      lineRange?: { start: number; end: number } | null;
      codeSnippet?: string;
    };

    // Build the consolidated issue
    // Note: cluster.issues is guaranteed to have at least 2 items by the clustering logic
    const firstIssue = cluster.issues[0]!;
    const consolidatedIssue: Omit<ApprovedIssue, 'ticketPath'> = {
      id: `consolidated-${cluster.id}`,
      agentId: 'consolidator',
      title: parsed.title ?? `Consolidated: ${firstIssue.title}`,
      description: parsed.description ?? cluster.issues.map(i => i.description).join('\n\n'),
      severity: getHighestSeverity(cluster.issues),
      filePath: parsed.primaryFilePath ?? firstIssue.filePath,
      lineRange: parsed.lineRange ?? undefined,
      category: parsed.category ?? firstIssue.category,
      recommendation: parsed.recommendation ?? cluster.issues.map(i => i.recommendation).join('\n'),
      codeSnippet: parsed.codeSnippet,
      votes: mergeVotes(cluster.issues),
      approvedAt: new Date().toISOString()
    };

    const durationMs = Date.now() - startTime;

    onProgress?.(`Consolidated ${cluster.issues.length} issues into one`);

    return {
      consolidatedIssue,
      originalIssueIds,
      durationMs,
      costUsd: totalCost
    };
  } catch (error) {
    onProgress?.(`Error during consolidation: ${error instanceof Error ? error.message : 'Unknown error'}`);
    throw error;
  }
}
