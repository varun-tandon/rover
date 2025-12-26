import { query } from '@anthropic-ai/claude-agent-sdk';
import type { CandidateIssue } from '../types/index.js';
import type { ScannerResult, ScannerOptions } from './types.js';
import { getAgent } from './definitions/index.js';
import { summarizeExistingIssues } from '../storage/issues.js';
import { loadMemory } from '../storage/memory.js';

/**
 * Run the scanner agent to detect issues in the codebase.
 *
 * Uses an AI agent to explore the codebase according to agent-specific guidelines,
 * identifying code quality issues, architectural problems, and potential improvements.
 *
 * @param options - Configuration for the scan
 * @param options.targetPath - Absolute path to the directory to scan
 * @param options.agentId - ID of the agent definition to use (determines scan focus)
 * @param options.existingIssues - Summaries of previously detected issues for deduplication
 * @param options.onProgress - Optional callback for real-time progress updates
 * @returns Scan results including detected issues, timing, and cost information
 * @throws Error if the specified agent ID is not found
 * @throws Error if the underlying AI query fails (network issues, API errors)
 */
// Model pricing in USD per million tokens (Sonnet 4.5)
const MODEL_PRICING = {
  inputPerMillion: 3,
  outputPerMillion: 15,
};

/**
 * Calculate cost from token usage
 */
function calculateCostFromUsage(usage: { input_tokens?: number; output_tokens?: number }): number {
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  return (inputTokens * MODEL_PRICING.inputPerMillion + outputTokens * MODEL_PRICING.outputPerMillion) / 1_000_000;
}

export async function runScanner(options: ScannerOptions): Promise<ScannerResult> {
  const { targetPath, agentId, onProgress, onCostUpdate } = options;

  const agentDef = getAgent(agentId);
  if (!agentDef) {
    throw new Error(`Unknown agent: ${agentId}`);
  }

  onProgress?.('Summarizing existing issues for deduplication...');
  const existingIssuesSummary = await summarizeExistingIssues(targetPath);

  onProgress?.('Loading memory...');
  const memoryContent = await loadMemory(targetPath);

  onProgress?.(`Starting scan with ${agentDef.name}...`);

  const startTime = Date.now();
  let totalCost = 0;
  let issues: CandidateIssue[] = [];

  const memorySection = memoryContent
    ? `\nKNOWN ISSUES TO IGNORE:\n${memoryContent}\n\nThese are intentionally ignored issues or false positives. Do NOT report issues that match these descriptions.\n`
    : '';

  const prompt = `You are scanning the codebase at the current working directory.

EXISTING ISSUES (DO NOT DUPLICATE THESE):
${existingIssuesSummary}
${memorySection}
SCANNING GUIDELINES:
${agentDef.systemPrompt}

FILE PATTERNS TO FOCUS ON:
${agentDef.filePatterns.join('\n')}

INSTRUCTIONS:
1. Use the Glob tool to find files matching the patterns above
2. Use the Read tool to examine the contents of relevant files
3. Use the Grep tool to search for specific patterns if needed
4. Analyze the code for issues according to your guidelines
5. DO NOT report issues that match any in the "EXISTING ISSUES" list above
6. Return your findings as a JSON object with an "issues" array

Each issue in the array should have:
- id: Unique identifier (format: {category-slug}-{short-hash})
- title: Short descriptive title
- description: Detailed explanation
- severity: "low" | "medium" | "high" | "critical"
- filePath: Relative path to the file
- lineRange: { start: number, end: number } (optional)
- category: Category name
- recommendation: Specific actionable fix
- codeSnippet: The problematic code (optional)

Return ONLY valid JSON. No markdown, no explanations outside the JSON.`;

  try {
    const agentQuery = query({
      prompt,
      options: {
        model: 'claude-sonnet-4-5-20250929',
        allowedTools: ['Glob', 'Grep', 'Read'],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        cwd: targetPath,
        maxTurns: 50,
      }
    });

    let resultText = '';
    let runningCost = 0;

    for await (const message of agentQuery) {
      if (message.type === 'result' && message.subtype === 'success') {
        resultText = message.result;
        totalCost = message.total_cost_usd;
        onCostUpdate?.(totalCost);
      }

      // Progress updates from assistant messages
      if (message.type === 'assistant') {
        // Track realtime cost from usage
        const usage = message.message.usage;
        if (usage) {
          runningCost += calculateCostFromUsage(usage);
          onCostUpdate?.(runningCost);
        }

        const content = message.message.content;
        for (const block of content) {
          if (block.type === 'tool_use') {
            if (block.name === 'Glob') {
              onProgress?.(`Searching for files: ${(block.input as { pattern?: string }).pattern ?? 'unknown pattern'}`);
            } else if (block.name === 'Read') {
              onProgress?.(`Reading: ${(block.input as { file_path?: string }).file_path ?? 'unknown file'}`);
            } else if (block.name === 'Grep') {
              onProgress?.(`Searching for: ${(block.input as { pattern?: string }).pattern ?? 'unknown pattern'}`);
            }
          }
        }
      }
    }

    // Parse the result
    if (resultText) {
      try {
        // Try to extract JSON from the result
        const jsonMatch = resultText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsedScannerOutput = JSON.parse(jsonMatch[0]) as { issues?: unknown[] };
          if (Array.isArray(parsedScannerOutput.issues)) {
            issues = parsedScannerOutput.issues.map((issue, index) => ({
              id: (issue as { id?: string }).id ?? `issue-${index}`,
              agentId,
              title: (issue as { title?: string }).title ?? 'Unknown Issue',
              description: (issue as { description?: string }).description ?? '',
              severity: ((issue as { severity?: string }).severity ?? 'medium') as CandidateIssue['severity'],
              filePath: (issue as { filePath?: string }).filePath ?? '',
              lineRange: (issue as { lineRange?: { start: number; end: number } }).lineRange,
              category: (issue as { category?: string }).category ?? 'General',
              recommendation: (issue as { recommendation?: string }).recommendation ?? '',
              codeSnippet: (issue as { codeSnippet?: string }).codeSnippet,
            }));
          }
        }
      } catch (parseError) {
        console.error('Failed to parse scanner result:', parseError);
      }
    }
  } catch (error) {
    onProgress?.(`Error during scan: ${error instanceof Error ? error.message : 'Unknown error'}`);
    throw error;
  }

  const durationMs = Date.now() - startTime;

  onProgress?.(`Scan complete. Found ${issues.length} candidate issues.`);

  return {
    issues,
    durationMs,
    filesScanned: 0, // We don't track this currently
    costUsd: totalCost
  };
}
