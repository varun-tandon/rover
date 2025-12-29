/**
 * Code review execution and parsing for the fix workflow
 */

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runAgent } from '../agents/agent-runner.js';
import type { ReviewItem, ReviewAnalysis } from './types.js';
import { filterIgnoredFiles, filterDiffByRoverignore } from '../storage/roverignore.js';

// Review prompt paths - check environment variables first, then fallback to bundled prompts
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ARCHITECTURE_REVIEW_PROMPT_PATH = process.env['ROVER_REVIEW_PROMPT_PATH']
  ?? join(__dirname, 'prompts', 'review-prompt.txt');
const BUG_REVIEW_PROMPT_PATH = process.env['ROVER_BUG_REVIEW_PROMPT_PATH']
  ?? join(__dirname, 'prompts', 'bug-review-prompt.txt');
const COMPLETENESS_REVIEW_PROMPT_PATH = process.env['ROVER_COMPLETENESS_REVIEW_PROMPT_PATH']
  ?? join(__dirname, 'prompts', 'completeness-review-prompt.txt');
const PERFORMANCE_REVIEW_PROMPT_PATH = process.env['ROVER_PERFORMANCE_REVIEW_PROMPT_PATH']
  ?? join(__dirname, 'prompts', 'performance-review-prompt.txt');

/**
 * Get the default branch name (main, master, etc.)
 */
async function getDefaultBranch(worktreePath: string): Promise<string> {
  return new Promise((resolve) => {
    // Try to get the default branch from remote
    const child = spawn('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], {
      cwd: worktreePath,
    });

    let stdout = '';
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        // Output is like "refs/remotes/origin/main" - extract "main"
        const branch = stdout.trim().split('/').pop() ?? 'main';
        resolve(branch);
      } else {
        // Fallback to 'main', then try 'master' if needed
        resolve('main');
      }
    });

    child.on('error', () => {
      resolve('main');
    });
  });
}

/**
 * Get the git diff between the worktree branch and the default branch
 */
async function getGitDiff(worktreePath: string): Promise<string> {
  const defaultBranch = await getDefaultBranch(worktreePath);

  return new Promise((resolve, reject) => {
    const child = spawn('git', ['diff', `${defaultBranch}...HEAD`], {
      cwd: worktreePath,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`git diff failed: ${stderr}`));
      }
    });

    child.on('error', reject);
  });
}

/**
 * Get the list of changed files
 */
async function getChangedFiles(worktreePath: string): Promise<string[]> {
  const defaultBranch = await getDefaultBranch(worktreePath);

  return new Promise((resolve, reject) => {
    const child = spawn('git', ['diff', '--name-only', `${defaultBranch}...HEAD`], {
      cwd: worktreePath,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim().split('\n').filter(Boolean));
      } else {
        reject(new Error(`git diff --name-only failed: ${stderr}`));
      }
    });

    child.on('error', reject);
  });
}

/**
 * Parse a stream-json line for tool usage information (for progress reporting)
 */
function parseReviewToolUsage(line: string): string | null {
  try {
    const parsed = JSON.parse(line);

    // Look for tool_use in assistant messages
    if (parsed.type === 'assistant' && parsed.message?.content) {
      for (const block of parsed.message.content) {
        if (block.type === 'tool_use') {
          const toolName = block.name;
          const input = block.input as Record<string, unknown>;

          switch (toolName) {
            case 'Read':
              return `[Review] Reading: ${input['file_path'] ?? 'file'}`;
            case 'Glob':
              return `[Review] Searching: ${input['pattern'] ?? 'files'}`;
            case 'Grep':
              return `[Review] Grepping: ${input['pattern'] ?? 'pattern'}`;
            case 'LS':
              return `[Review] Listing: ${input['path'] ?? 'directory'}`;
            default:
              return `[Review] Using ${toolName}`;
          }
        }
      }
    }

    // Look for text content (Claude's thinking/responses)
    if (parsed.type === 'assistant' && parsed.message?.content) {
      for (const block of parsed.message.content) {
        if (block.type === 'text' && block.text) {
          // Extract first line as a status hint
          const firstLine = String(block.text).split('\n')[0]?.slice(0, 60);
          if (firstLine && firstLine.length > 10) {
            return `[Review] ${firstLine}${String(block.text).length > 60 ? '...' : ''}`;
          }
        }
      }
    }
  } catch {
    // Not valid JSON, ignore
  }
  return null;
}

/**
 * Parse a stream-json line for text content (for verbose output)
 */
function parseReviewTextContent(line: string): string | null {
  try {
    const parsed = JSON.parse(line);

    // Extract text from assistant messages
    if (parsed.type === 'assistant' && parsed.message?.content) {
      const texts: string[] = [];
      for (const block of parsed.message.content) {
        if (block.type === 'text' && block.text) {
          texts.push(String(block.text));
        }
        if (block.type === 'tool_use') {
          const toolName = block.name;
          const input = block.input as Record<string, unknown>;
          // Show tool usage in a readable format
          if (toolName === 'Read') {
            texts.push(`[Tool: ${toolName}] ${input['file_path'] ?? ''}`);
          } else if (toolName === 'Glob' || toolName === 'Grep') {
            texts.push(`[Tool: ${toolName}] ${input['pattern'] ?? ''}`);
          } else if (toolName === 'LS') {
            texts.push(`[Tool: ${toolName}] ${input['path'] ?? ''}`);
          } else {
            texts.push(`[Tool: ${toolName}]`);
          }
        }
      }
      if (texts.length > 0) {
        return texts.join('\n');
      }
    }

    // Show tool results
    if (parsed.type === 'user' && parsed.message?.content) {
      for (const block of parsed.message.content) {
        if (block.type === 'tool_result') {
          const content = block.content;
          if (typeof content === 'string' && content.length < 500) {
            return `[Result] ${content.slice(0, 200)}${content.length > 200 ? '...' : ''}`;
          }
        }
      }
    }
  } catch {
    // Not valid JSON
  }
  return null;
}

/**
 * Extract text content from stream-json output for the final review result
 */
function extractReviewText(output: string): string {
  const lines = output.split('\n');
  const textParts: string[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const parsed = JSON.parse(line);

      // Extract text from assistant messages
      if (parsed.type === 'assistant' && parsed.message?.content) {
        for (const block of parsed.message.content) {
          if (block.type === 'text' && block.text) {
            textParts.push(String(block.text));
          }
        }
      }
    } catch {
      // Not valid JSON, ignore
    }
  }

  return textParts.join('\n') || output;
}

interface ReviewOptions {
  onProgress?: (message: string) => void;
  verbose?: boolean;
  issueContent?: string;
}

type ReviewType = 'architecture' | 'bug' | 'completeness' | 'performance';

interface FullReviewResult {
  architectureReview: string;
  bugReview: string;
  completenessReview: string;
  performanceReview: string;
  combined: string;
}

/**
 * Run a single code review using Claude CLI with the specified review prompt
 * The reviewer only has read-only access to the codebase (Read, Glob, Grep, LS)
 */
async function runSingleReview(
  worktreePath: string,
  reviewType: ReviewType,
  options: ReviewOptions = {}
): Promise<string> {
  const { onProgress, verbose, issueContent } = options;

  // Completeness review requires issue content
  if (reviewType === 'completeness' && !issueContent) {
    throw new Error('Completeness review requires issue content');
  }

  // Select the appropriate prompt based on review type
  const promptPath = reviewType === 'architecture'
    ? ARCHITECTURE_REVIEW_PROMPT_PATH
    : reviewType === 'bug'
      ? BUG_REVIEW_PROMPT_PATH
      : reviewType === 'performance'
        ? PERFORMANCE_REVIEW_PROMPT_PATH
        : COMPLETENESS_REVIEW_PROMPT_PATH;
  const reviewLabel = reviewType === 'architecture'
    ? 'Architecture Review'
    : reviewType === 'bug'
      ? 'Bug Review'
      : reviewType === 'performance'
        ? 'Performance Review'
        : 'Completeness Review';

  // Read the review prompt template
  const reviewPromptTemplate = await readFile(promptPath, 'utf-8');

  // Get the diff and changed files
  const [rawDiff, rawChangedFiles] = await Promise.all([
    getGitDiff(worktreePath),
    getChangedFiles(worktreePath),
  ]);

  // Filter files and diff based on .roverignore
  const [diff, changedFiles] = await Promise.all([
    filterDiffByRoverignore(worktreePath, rawDiff),
    filterIgnoredFiles(worktreePath, rawChangedFiles),
  ]);

  if (!diff.trim()) {
    return 'No changes to review. LGTM.';
  }

  // Construct the review prompt based on review type
  let prompt: string;

  if (reviewType === 'completeness') {
    // Completeness review has a different structure - issue content is primary
    prompt = `${reviewPromptTemplate}

ORIGINAL ISSUE TO VERIFY:
${issueContent}

CHANGED FILES:
${changedFiles.join('\n')}

DIFF:
\`\`\`diff
${diff}
\`\`\`

Verify that ALL items from the original issue have been addressed by these changes. Output your findings in the format specified above.`;
  } else {
    // Architecture and bug reviews use the standard structure
    const issueSection = issueContent ? `
ORIGINAL ISSUE TO FIX:
${issueContent}

CRITICAL: In addition to general code review, you MUST verify that ALL items in the original issue have been addressed by the changes. If any required fix from the issue is missing or incomplete, flag it as a "must_fix" item. Do not approve changes that only partially address the issue.

` : '';

    prompt = `${reviewPromptTemplate}

${issueSection}CHANGED FILES:
${changedFiles.join('\n')}

DIFF:
\`\`\`diff
${diff}
\`\`\`

Please review the changes above according to the guidelines provided.${issueContent ? ' Pay special attention to whether ALL requirements from the original issue have been addressed.' : ''}`;
  }

  // Run Claude CLI for the review with read-only tools
  return new Promise((resolve, reject) => {
    const args = [
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
      '--allowedTools', 'Read,Glob,Grep,LS,mcp__*', // Read-only tools + MCP
      '--model', 'sonnet',
    ];

    if (onProgress) {
      onProgress(`[${reviewLabel}] Starting review...`);
    }

    if (verbose) {
      console.log(`[verbose] [${reviewLabel}] cwd: ${worktreePath}`);
      console.log(`[verbose] [${reviewLabel}] Prompt length: ${prompt.length} chars`);
    }

    const child = spawn('claude', args, {
      cwd: worktreePath,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Write prompt to stdin and close it
    child.stdin.write(prompt);
    child.stdin.end();

    if (verbose) {
      console.log(`[verbose] [${reviewLabel}] Process spawned with PID: ${child.pid}`);
    }

    let stdout = '';
    let stderr = '';
    let lineBuffer = '';

    child.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;

      // Parse streaming output for progress updates and verbose logging
      if (onProgress || verbose) {
        lineBuffer += chunk;
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() ?? ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.trim()) {
            if (verbose) {
              // In verbose mode, stream raw text content directly to stdout
              const textContent = parseReviewTextContent(line);
              if (textContent) {
                console.log(`[review] ${textContent}`);
              } else {
                // Show raw JSON type for debugging if we can't parse content
                try {
                  const parsed = JSON.parse(line);
                  if (parsed.type) {
                    console.log(`[review] [${parsed.type}]`);
                  }
                } catch {
                  // Not JSON
                }
              }
            }

            if (onProgress) {
              const toolMessage = parseReviewToolUsage(line);
              if (toolMessage) {
                onProgress(toolMessage);
              }
            }
          }
        }
      }
    });

    child.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      if (verbose) {
        console.log(`[review] [stderr] ${chunk}`);
      }
    });

    child.on('close', (code) => {
      if (onProgress) {
        onProgress(`[${reviewLabel}] Review complete`);
      }

      if (code === 0) {
        // Extract text content from stream-json output
        resolve(extractReviewText(stdout));
      } else {
        // Even if claude exits non-zero, we might have useful output
        const text = extractReviewText(stdout);
        resolve(text || `Review failed: ${stderr}`);
      }
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to run review: ${err.message}`));
    });
  });
}

/**
 * Run architecture-focused code review (backwards compatible)
 * The reviewer only has read-only access to the codebase (Read, Glob, Grep, LS)
 */
export async function runReview(
  worktreePath: string,
  options: ReviewOptions = {}
): Promise<string> {
  return runSingleReview(worktreePath, 'architecture', options);
}

/**
 * Run bug-focused code review
 * Checks for implementation errors, runtime bugs, and common mistakes
 */
export async function runBugReview(
  worktreePath: string,
  options: ReviewOptions = {}
): Promise<string> {
  return runSingleReview(worktreePath, 'bug', options);
}

/**
 * Run completeness review
 * Verifies that ALL items from the original issue have been addressed
 * Requires issueContent to be provided
 */
export async function runCompletenessReview(
  worktreePath: string,
  options: ReviewOptions & { issueContent: string }
): Promise<string> {
  return runSingleReview(worktreePath, 'completeness', options);
}

/**
 * Run performance-focused code review
 * Checks for performance issues, inefficiencies, and potential bottlenecks
 */
export async function runPerformanceReview(
  worktreePath: string,
  options: ReviewOptions = {}
): Promise<string> {
  return runSingleReview(worktreePath, 'performance', options);
}

/**
 * Run architecture, bug, performance, and completeness reviews
 * All reviews must pass for the fix to be considered complete
 * Completeness review only runs if issueContent is provided
 */
export async function runFullReview(
  worktreePath: string,
  options: ReviewOptions = {}
): Promise<FullReviewResult> {
  const { onProgress, issueContent } = options;

  // Run reviews sequentially to avoid resource contention
  if (onProgress) {
    onProgress('[Full Review] Starting architecture review...');
  }
  const architectureReview = await runSingleReview(worktreePath, 'architecture', options);

  if (onProgress) {
    onProgress('[Full Review] Starting bug review...');
  }
  const bugReview = await runSingleReview(worktreePath, 'bug', options);

  if (onProgress) {
    onProgress('[Full Review] Starting performance review...');
  }
  const performanceReview = await runSingleReview(worktreePath, 'performance', options);

  // Run completeness review only if issue content is provided
  let completenessReview = '';
  if (issueContent) {
    if (onProgress) {
      onProgress('[Full Review] Starting completeness review...');
    }
    completenessReview = await runSingleReview(worktreePath, 'completeness', options);
  }

  // Combine the reviews
  const completenessSection = completenessReview
    ? `

## Completeness Review

${completenessReview}`
    : '';

  const combined = `## Architecture Review

${architectureReview}

## Bug Review

${bugReview}

## Performance Review

${performanceReview}${completenessSection}`;

  return {
    architectureReview,
    bugReview,
    completenessReview,
    performanceReview,
    combined,
  };
}

/**
 * Parse review output to extract actionable items using Claude SDK
 */
export async function parseReviewForActionables(
  reviewOutput: string
): Promise<ReviewAnalysis> {
  // Quick check for obviously clean reviews - return early if clearly positive
  const lowerReview = reviewOutput.toLowerCase();
  if (
    lowerReview.includes('lgtm') ||
    lowerReview.includes('looks good to me') ||
    lowerReview.includes('no issues found') ||
    lowerReview.includes('no actionable items') ||
    lowerReview.includes('no bugs found')
  ) {
    return {
      isClean: true,
      items: [],
    };
  }

  const parsePrompt = `Analyze this code review and extract actionable items.

REVIEW:
${reviewOutput}

Return a JSON object with this structure:
{
  "isClean": true/false,
  "items": [
    {
      "severity": "must_fix" | "should_fix" | "suggestion",
      "description": "what needs to be fixed",
      "file": "optional file path"
    }
  ]
}

Severity definitions:
- "must_fix": bugs, security issues, breaking changes, logic errors, violations of critical design principles
- "should_fix": significant design issues, complexity concerns, code quality problems
- "suggestion": minor improvements, style preferences, optional enhancements

Rules:
- If the review is positive with no actionable feedback, set isClean to true and items to []
- Ignore positive comments, only extract things that need to be changed
- Be conservative: only mark as "must_fix" if it's truly critical
- Comments about style preferences or "could do X" without strong recommendation are "suggestion"

Return ONLY the JSON, no markdown, no explanation.`;

  try {
    const result = await runAgent({
      prompt: parsePrompt,
      cwd: process.cwd(),
      allowedTools: [],
    });

    const resultText = result.resultText;

    // Parse the JSON response
    const jsonMatch = resultText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as {
        isClean?: boolean;
        items?: Array<{
          severity?: string;
          description?: string;
          file?: string;
        }>;
      };

      const items: ReviewItem[] = (parsed.items ?? []).map((item) => ({
        severity: (item.severity ?? 'suggestion') as ReviewItem['severity'],
        description: item.description ?? '',
        file: item.file,
      }));

      return {
        isClean: parsed.isClean ?? items.length === 0,
        items,
      };
    }
  } catch (error) {
    console.error('Failed to parse review:', error);
  }

  // Default: treat as needing review if we couldn't parse
  return {
    isClean: false,
    items: [
      {
        severity: 'should_fix',
        description: 'Could not parse review output. Manual review required.',
      },
    ],
  };
}

/**
 * Check if a review has actionable items that require another iteration
 */
export function hasActionableItems(analysis: ReviewAnalysis): boolean {
  if (analysis.isClean) {
    return false;
  }

  // Only "must_fix" and "should_fix" items require iteration
  // "suggestion" items don't block completion
  return analysis.items.some(
    (item) => item.severity === 'must_fix' || item.severity === 'should_fix'
  );
}

/**
 * Verify that Claude's dismissal of review findings is legitimate.
 * Uses a skeptical reviewer to check each actionable item (must_fix or should_fix).
 */
export async function verifyReviewDismissal(
  itemsToVerify: ReviewItem[],
  claudeJustification: string,
  _worktreePath: string,
  options?: { onProgress?: (msg: string) => void }
): Promise<{
  allVerified: boolean;
  remainingItems: ReviewItem[];
}> {
  if (itemsToVerify.length === 0) {
    return { allVerified: true, remainingItems: [] };
  }

  options?.onProgress?.('Verifying review dismissal...');

  const verifyPrompt = `You are a skeptical code reviewer verifying whether review findings were correctly dismissed.

ORIGINAL FINDINGS (must_fix or should_fix severity):
${itemsToVerify.map((item, i) => `${i + 1}. [${item.severity}] ${item.description}${item.file ? ` (${item.file})` : ''}`).join('\n')}

CLAUDE'S JUSTIFICATION FOR DISMISSING THEM:
${claudeJustification}

Your job: For each finding, determine if Claude's dismissal is VALID or INVALID.

A dismissal is VALID if:
- The finding was factually incorrect (code doesn't work that way)
- The finding was about code not changed in this PR
- The issue was already handled elsewhere in the code

A dismissal is INVALID if:
- Claude is making assumptions about external systems (RLS, middleware) without verification
- Claude is downplaying real security/correctness issues
- The justification is vague or doesn't directly address the finding

Be SKEPTICAL. When in doubt, mark as INVALID.

Return JSON:
{
  "items": [
    { "index": 1, "valid": true, "reason": "brief explanation" },
    { "index": 2, "valid": false, "reason": "brief explanation" }
  ]
}

Return ONLY the JSON, no markdown, no explanation.`;

  try {
    const result = await runAgent({
      prompt: verifyPrompt,
      cwd: process.cwd(),
      allowedTools: [],
    });

    const resultText = result.resultText;

    // Parse response
    const jsonMatch = resultText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // Parse failed - be conservative, keep all items
      return { allVerified: false, remainingItems: itemsToVerify };
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      items?: Array<{ index?: number; valid?: boolean; reason?: string }>;
    };
    const remainingItems: ReviewItem[] = [];

    for (const item of parsed.items ?? []) {
      if (!item.valid && item.index !== undefined && item.index >= 1 && item.index <= itemsToVerify.length) {
        const originalItem = itemsToVerify[item.index - 1];
        if (originalItem) {
          remainingItems.push(originalItem);
        }
      }
    }

    return {
      allVerified: remainingItems.length === 0,
      remainingItems,
    };
  } catch (error) {
    // On error, be conservative - don't verify
    console.error('Error verifying review dismissal:', error);
    return { allVerified: false, remainingItems: itemsToVerify };
  }
}
