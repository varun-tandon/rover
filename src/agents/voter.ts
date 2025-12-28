import { runAgent } from './agent-runner.js';
import type { CandidateIssue, Vote } from '../types/index.js';
import type { VoterResult, VoterOptions } from './types.js';
import { getAgent } from './definitions/index.js';

/**
 * Run a voter agent to validate candidate issues.
 *
 * Each voter independently reviews candidate issues by reading the actual source files
 * and deciding whether each issue is genuine and worth addressing. Voters provide
 * approve/reject votes with reasoning for each issue.
 *
 * @param options - Configuration for the voter
 * @param options.voterId - Unique identifier for this voter (e.g., 'voter-1')
 * @param options.targetPath - Absolute path to the codebase for reading source files
 * @param options.agentId - ID of the agent that detected the issues (for context)
 * @param options.issues - Array of candidate issues to vote on
 * @param options.onProgress - Optional callback invoked before/after each issue vote
 * @returns Voting results including all votes cast, timing, and cost information
 * @throws Error if the specified agent ID is not found
 */
export async function runVoter(options: VoterOptions): Promise<VoterResult> {
  const { voterId, targetPath, agentId, issues, onProgress } = options;

  const agentDef = getAgent(agentId);
  if (!agentDef) {
    throw new Error(`Unknown agent: ${agentId}`);
  }

  const startTime = Date.now();
  const votes: Vote[] = [];

  // Vote on each issue sequentially
  for (const issue of issues) {
    onProgress?.(issue.id, false);

    const prompt = `You are an independent code quality reviewer. Your task is to validate whether a detected issue is genuine and worth addressing.

CONTEXT:
- This issue was detected by "${agentDef.name}"
- The scanner's guidelines were: ${agentDef.description}

CANDIDATE ISSUE TO REVIEW:
- ID: ${issue.id}
- Title: ${issue.title}
- Description: ${issue.description}
- Severity: ${issue.severity}
- File: ${issue.filePath}${issue.lineRange ? `:${issue.lineRange.start}-${issue.lineRange.end}` : ''}
- Category: ${issue.category}
- Recommendation: ${issue.recommendation}
${issue.codeSnippet ? `\nCode Snippet:\n\`\`\`\n${issue.codeSnippet}\n\`\`\`` : ''}

INSTRUCTIONS:
1. Use the Read tool to examine the actual file and verify the issue exists
2. Consider whether:
   - The issue is a genuine problem (not a false positive)
   - The severity is appropriate
   - The recommendation makes sense
   - This would actually improve the codebase if fixed

3. Return your vote as JSON:
{
  "approve": true/false,
  "reasoning": "Brief explanation of your decision"
}

Be critical but fair. Approve issues that are genuine and would benefit from being fixed.
Reject issues that are false positives, overly pedantic, or where the fix would cause more harm than good.

Return ONLY valid JSON. No markdown, no explanations outside the JSON.`;

    try {
      const result = await runAgent({
        prompt,
        cwd: targetPath,
        allowedTools: ['Read'],
      });

      const resultText = result.resultText;

      // Parse the vote
      let approve = false;
      let reasoning = 'No reasoning provided';

      if (resultText) {
        try {
          const jsonMatch = resultText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsedVoteResponse = JSON.parse(jsonMatch[0]) as { approve?: boolean; reasoning?: string };
            approve = parsedVoteResponse.approve ?? false;
            reasoning = parsedVoteResponse.reasoning ?? 'No reasoning provided';
          }
        } catch {
          // Default to reject if we can't parse the vote
          reasoning = 'Failed to parse vote response';
        }
      }

      votes.push({
        voterId,
        issueId: issue.id,
        approve,
        reasoning
      });

      onProgress?.(issue.id, true);
    } catch (error) {
      // On error, cast a "no" vote with error reasoning
      votes.push({
        voterId,
        issueId: issue.id,
        approve: false,
        reasoning: `Error during voting: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
      onProgress?.(issue.id, true);
    }
  }

  const durationMs = Date.now() - startTime;

  return {
    voterId,
    votes,
    durationMs,
  };
}

/**
 * Run multiple voters in parallel to validate candidate issues.
 *
 * Creates multiple independent voter agents that concurrently review all candidate issues.
 * Each voter has its own perspective and voting decisions, enabling consensus-based validation.
 *
 * @param targetPath - Absolute path to the codebase for reading source files
 * @param agentId - ID of the agent that detected the issues (for context)
 * @param issues - Array of candidate issues for all voters to evaluate
 * @param voterCount - Number of parallel voters to run (default: 3 for 2/3 majority voting)
 * @param onProgress - Optional callback invoked for each voter's progress on each issue.
 *   Called with (voterId, issueId, completed) where completed indicates vote was cast.
 * @returns Array of VoterResult objects, one per voter, containing all votes and metadata
 *
 * @example
 * const results = await runVotersInParallel(
 *   '/path/to/codebase',
 *   'critical-path-scout',
 *   candidateIssues,
 *   3,
 *   (voterId, issueId, done) => console.log(`${voterId}: ${issueId} ${done ? 'done' : 'voting'}`)
 * );
 */
export async function runVotersInParallel(
  targetPath: string,
  agentId: string,
  issues: CandidateIssue[],
  voterCount: number = 3,
  onProgress?: (voterId: string, issueId: string, completed: boolean) => void
): Promise<VoterResult[]> {
  const voterPromises = Array.from({ length: voterCount }, (_, i) => {
    const voterId = `voter-${i + 1}`;
    return runVoter({
      voterId,
      targetPath,
      agentId,
      issues,
      onProgress: (issueId, completed) => onProgress?.(voterId, issueId, completed)
    });
  });

  return Promise.all(voterPromises);
}
