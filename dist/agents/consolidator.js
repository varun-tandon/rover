/**
 * Consolidator agent for merging related issues into a single comprehensive issue.
 * Uses an LLM to analyze the issues and produce a merged version.
 */
import { runAgent } from './agent-runner.js';
import { extractTicketId } from '../storage/tickets.js';
/**
 * Format an issue for inclusion in the prompt
 */
function formatIssueForPrompt(issue) {
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
function getHighestSeverity(issues) {
    const severityOrder = ['critical', 'high', 'medium', 'low'];
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
function mergeVotes(issues) {
    const allVotes = issues.flatMap(i => i.votes);
    // Deduplicate by voterId, keeping the first vote from each voter
    const seenVoters = new Set();
    return allVotes.filter(vote => {
        if (seenVoters.has(vote.voterId))
            return false;
        seenVoters.add(vote.voterId);
        return true;
    });
}
/**
 * Run the consolidator agent to merge a cluster of related issues.
 */
export async function runConsolidator(options) {
    const { targetPath, cluster, onProgress } = options;
    const startTime = Date.now();
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
        const result = await runAgent({
            prompt,
            cwd: targetPath,
            allowedTools: ['Read'],
            onProgress,
        });
        const resultText = result.resultText;
        // Parse the result
        if (!resultText) {
            throw new Error('No result from consolidator agent');
        }
        const jsonMatch = resultText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('Failed to parse consolidator response as JSON');
        }
        const parsed = JSON.parse(jsonMatch[0]);
        // Build the consolidated issue
        // Note: cluster.issues is guaranteed to have at least 2 items by the clustering logic
        const firstIssue = cluster.issues[0];
        const consolidatedIssue = {
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
        };
    }
    catch (error) {
        onProgress?.(`Error during consolidation: ${error instanceof Error ? error.message : 'Unknown error'}`);
        throw error;
    }
}
