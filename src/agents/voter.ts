import { query } from '@anthropic-ai/claude-agent-sdk';
import type { CandidateIssue, Vote } from '../types/index.js';
import type { VoterResult, VoterOptions } from './types.js';
import { getAgent } from './definitions/index.js';

/**
 * Run a voter agent to validate candidate issues
 */
export async function runVoter(options: VoterOptions): Promise<VoterResult> {
  const { voterId, targetPath, agentId, issues, onProgress } = options;

  const agentDef = getAgent(agentId);
  if (!agentDef) {
    throw new Error(`Unknown agent: ${agentId}`);
  }

  const startTime = Date.now();
  let totalCost = 0;
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
      const voterQuery = query({
        prompt,
        options: {
          model: 'claude-sonnet-4-5-20250929',
          allowedTools: ['Read'],
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          cwd: targetPath,
          maxTurns: 10,
        }
      });

      let resultText = '';

      for await (const message of voterQuery) {
        if (message.type === 'result' && message.subtype === 'success') {
          resultText = message.result;
          totalCost += message.total_cost_usd;
        }
      }

      // Parse the vote
      let approve = false;
      let reasoning = 'No reasoning provided';

      if (resultText) {
        try {
          const jsonMatch = resultText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]) as { approve?: boolean; reasoning?: string };
            approve = parsed.approve ?? false;
            reasoning = parsed.reasoning ?? 'No reasoning provided';
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
    costUsd: totalCost
  };
}

/**
 * Run multiple voters in parallel
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
