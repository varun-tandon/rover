/**
 * Planner agent for analyzing issue dependencies and creating work plans.
 * Uses an LLM to infer logical dependencies between issues.
 */

import path from 'path';
import { runAgent } from './agent-runner.js';
import type { ApprovedIssue, DependencyAnalysis, IssueDependency, ParallelGroup } from '../types/index.js';
import { extractTicketId } from '../storage/tickets.js';

/**
 * Options for running the planner
 */
export interface PlannerOptions {
  /** Target directory containing the code */
  targetPath: string;
  /** Issues to analyze for dependencies */
  issues: ApprovedIssue[];
  /** Callback for progress updates */
  onProgress?: (message: string) => void;
}

/**
 * Result from the planner
 */
export interface PlannerResult {
  /** The dependency analysis */
  analysis: DependencyAnalysis;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Convert a file path to absolute if it's relative
 */
function toAbsolutePath(filePath: string, targetPath: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.join(targetPath, filePath);
}

/**
 * Format an issue for inclusion in the prompt
 */
function formatIssueForPrompt(issue: ApprovedIssue, targetPath: string): string {
  const ticketId = extractTicketId(issue.ticketPath) ?? issue.id;
  const absoluteFilePath = toAbsolutePath(issue.filePath, targetPath);
  const lines = [
    `### ${ticketId}`,
    `- **Title**: ${issue.title}`,
    `- **Severity**: ${issue.severity}`,
    `- **Category**: ${issue.category}`,
    `- **File**: ${absoluteFilePath}${issue.lineRange ? `:${issue.lineRange.start}-${issue.lineRange.end}` : ''}`,
    `- **Description**: ${issue.description}`,
    `- **Recommendation**: ${issue.recommendation}`
  ];

  if (issue.codeSnippet) {
    lines.push(`- **Code**:\n\`\`\`\n${issue.codeSnippet}\n\`\`\``);
  }

  return lines.join('\n');
}

/**
 * Run the planner agent to analyze dependencies between issues.
 */
export async function runPlanner(options: PlannerOptions): Promise<PlannerResult> {
  const { targetPath, issues, onProgress } = options;

  const startTime = Date.now();

  onProgress?.(`Analyzing dependencies for ${issues.length} issues...`);

  // Collect unique file paths from all issues (converted to absolute paths)
  const uniqueFilePaths = [...new Set(issues.map(i => toAbsolutePath(i.filePath, targetPath)))];

  // Get all ticket IDs for reference
  const ticketIds = issues.map(issue => extractTicketId(issue.ticketPath) ?? issue.id);

  const prompt = `You are a Work Planning Agent analyzing code issues to determine dependencies and parallelization opportunities.

## GOAL
Analyze the provided issues and determine:
1. Which issues depend on others (must be fixed in sequence)
2. Which issues conflict (should not be worked on simultaneously)
3. Which issues are independent (can be parallelized across worktrees)

## DEPENDENCY TYPES
- **blocks**: Issue A must be completed before B can start (code dependency, data flow)
- **conflicts**: A and B modify the same code and will cause merge conflicts
- **enables**: Completing A makes B easier/possible but isn't strictly required

## ISSUES TO ANALYZE

${issues.map(issue => formatIssueForPrompt(issue, targetPath)).join('\n\n---\n\n')}

## AFFECTED FILES
${uniqueFilePaths.map(fp => `- ${fp}`).join('\n')}

## INSTRUCTIONS

1. Read the code files listed above to understand the actual code structure. Use the EXACT file paths provided - do not modify or guess different paths.
2. Analyze relationships between issues:
   - Look for shared functions, components, or modules
   - Identify data flow dependencies (A produces what B consumes)
   - Consider architectural layers (fix foundation before features)
   - Identify merge conflict risks (same file, nearby lines)
3. Group independent issues into parallel workstreams
4. Determine the optimal execution order

## OUTPUT FORMAT

Return ONLY valid JSON with this exact structure:

{
  "dependencies": [
    { "from": "ISSUE-XXX", "to": "ISSUE-YYY", "type": "blocks", "reason": "explanation" }
  ],
  "parallelGroups": [
    { "name": "Workstream Name", "issueIds": ["ISSUE-XXX", "ISSUE-YYY"] }
  ],
  "summary": "High-level analysis summary explaining the dependency structure and recommended approach",
  "executionOrder": ["ISSUE-XXX", "ISSUE-YYY", ...],
  "commandsMarkdown": "## Commands\\n\\nRun these commands in order...\\n\\n\`\`\`bash\\nrover fix ISSUE-XXX\\nrover fix ISSUE-YYY\\n\`\`\`\\n\\nOr run all at once:\\n\\n\`\`\`bash\\nrover fix ISSUE-XXX ISSUE-YYY\\n\`\`\`"
}

## CONSTRAINTS

- Every issue MUST appear in exactly one parallelGroup
- The issue IDs are: ${ticketIds.join(', ')}
- Dependencies should only exist between issues in different parallel groups OR within a group to show sequence
- executionOrder should list ALL issues in recommended fix order
- Keep summary concise but informative (2-3 sentences)
- commandsMarkdown MUST contain a markdown section with \`rover fix\` commands in the correct dependency order
  - Include brief explanations of why certain issues must come before others
  - Show both sequential commands and a combined command to run all at once

Return ONLY the JSON object. No markdown, no explanations outside the JSON.`;

  try {
    const result = await runAgent({
      prompt,
      cwd: targetPath,
      allowedTools: ['Read', 'Grep'],
      onProgress,
    });

    const resultText = result.resultText;

    // Parse the result
    if (!resultText) {
      throw new Error('No result from planner agent');
    }

    // Check for rate limit messages
    if (resultText.toLowerCase().includes('hit your limit') || resultText.toLowerCase().includes('resets')) {
      throw new Error('Claude API rate limit reached. Please try again later.');
    }

    const parsed = extractJsonFromText(resultText) as {
      dependencies?: Array<{
        from?: string;
        to?: string;
        type?: string;
        reason?: string;
      }>;
      parallelGroups?: Array<{
        name?: string;
        issueIds?: string[];
      }>;
      summary?: string;
      executionOrder?: string[];
      commandsMarkdown?: string;
    };

    // Build the analysis with fallbacks
    const dependencies: IssueDependency[] = (parsed.dependencies ?? []).map(dep => ({
      from: dep.from ?? '',
      to: dep.to ?? '',
      type: (dep.type as 'blocks' | 'conflicts' | 'enables') ?? 'blocks',
      reason: dep.reason ?? ''
    })).filter(dep => dep.from && dep.to);

    const parallelGroups: ParallelGroup[] = (parsed.parallelGroups ?? []).map(group => ({
      name: group.name ?? 'Unnamed Group',
      issueIds: group.issueIds ?? []
    })).filter(group => group.issueIds.length > 0);

    // If no groups were created, put all issues in one group
    if (parallelGroups.length === 0) {
      parallelGroups.push({
        name: 'All Issues',
        issueIds: ticketIds
      });
    }

    // Ensure all issues are in a group
    const groupedIds = new Set(parallelGroups.flatMap(g => g.issueIds));
    const ungrouped = ticketIds.filter(id => !groupedIds.has(id));
    if (ungrouped.length > 0) {
      parallelGroups.push({
        name: 'Independent',
        issueIds: ungrouped
      });
    }

    const executionOrder = parsed.executionOrder ?? ticketIds;

    const analysis: DependencyAnalysis = {
      dependencies,
      parallelGroups,
      summary: parsed.summary ?? 'Analysis complete.',
      executionOrder,
      commandsMarkdown: parsed.commandsMarkdown
    };

    const durationMs = Date.now() - startTime;

    onProgress?.(`Analysis complete. Found ${dependencies.length} dependencies, ${parallelGroups.length} workstreams.`);

    return {
      analysis,
      durationMs,
    };
  } catch (error) {
    onProgress?.(`Error during planning: ${error instanceof Error ? error.message : 'Unknown error'}`);
    throw error;
  }
}

/**
 * Robustly extract JSON from text that might contain markdown or explanations
 */
function extractJsonFromText(text: string): any {
  // 1. Try parsing the whole text
  try {
    return JSON.parse(text);
  } catch {}

  // 2. Try extracting from markdown code blocks
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/g;
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    try {
      if (match[1]) {
        return JSON.parse(match[1]);
      }
    } catch {}
  }

  // 3. Try finding the outermost JSON object
  const firstOpen = text.indexOf('{');
  const lastClose = text.lastIndexOf('}');
  if (firstOpen !== -1 && lastClose !== -1 && lastClose > firstOpen) {
    const candidate = text.substring(firstOpen, lastClose + 1);
    try {
      return JSON.parse(candidate);
    } catch {}
  }

  throw new Error('Failed to parse planner response as JSON');
}
