/**
 * Claude CLI interaction for the fix workflow
 */

import { spawn } from 'node:child_process';
import type { ClaudeResult } from './types.js';

interface ClaudeOptions {
  prompt: string;
  cwd: string;
  sessionId?: string;
  model?: 'sonnet' | 'opus' | 'haiku';
  onProgress?: (message: string) => void;
  verbose?: boolean;
}

/**
 * Parse a stream-json line for text content (for verbose output)
 */
function parseTextContent(line: string): string | null {
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
          if (toolName === 'Bash') {
            texts.push(`[Tool: ${toolName}] ${input['command'] ?? ''}`);
          } else if (toolName === 'Read' || toolName === 'Edit' || toolName === 'Write') {
            texts.push(`[Tool: ${toolName}] ${input['file_path'] ?? ''}`);
          } else if (toolName === 'Glob' || toolName === 'Grep') {
            texts.push(`[Tool: ${toolName}] ${input['pattern'] ?? ''}`);
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
 * Parse a stream-json line for tool usage information
 */
function parseToolUsage(line: string): string | null {
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
              return `Reading: ${input['file_path'] ?? 'file'}`;
            case 'Glob':
              return `Searching: ${input['pattern'] ?? 'files'}`;
            case 'Grep':
              return `Grepping: ${input['pattern'] ?? 'pattern'}`;
            case 'Edit':
              return `Editing: ${input['file_path'] ?? 'file'}`;
            case 'Write':
              return `Writing: ${input['file_path'] ?? 'file'}`;
            case 'Bash': {
              const cmd = String(input['command'] ?? '').slice(0, 50);
              return `Running: ${cmd}${String(input['command'] ?? '').length > 50 ? '...' : ''}`;
            }
            case 'LSP':
              return `LSP ${input['operation']}: ${input['filePath'] ?? 'file'}`;
            default:
              return `Using ${toolName}`;
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
            return firstLine + (String(block.text).length > 60 ? '...' : '');
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
 * Run the Claude CLI with the given options
 */
export async function runClaude(options: ClaudeOptions): Promise<ClaudeResult> {
  const args = [
    '--print',
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'bypassPermissions',
  ];

  if (options.sessionId) {
    args.push('--resume', options.sessionId);
  }

  if (options.model) {
    args.push('--model', options.model);
  }

  // Prompt will be passed via stdin (command line has length limits)

  return new Promise((resolve, reject) => {
    if (options.verbose) {
      console.log(`[verbose] cwd: ${options.cwd}`);
      console.log(`[verbose] Prompt length: ${options.prompt.length} chars`);
      console.log(`[verbose] To run manually:`);
      console.log(`cd "${options.cwd}" && echo "YOUR_PROMPT" | claude ${args.join(' ')}`);
    }

    const child = spawn('claude', args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Write prompt to stdin and close it
    child.stdin.write(options.prompt);
    child.stdin.end();

    if (options.verbose) {
      console.log(`[verbose] Process spawned with PID: ${child.pid}`);
    }

    let stdout = '';
    let stderr = '';
    let lineBuffer = '';

    child.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;

      // Parse streaming output for progress updates
      if (options.onProgress || options.verbose) {
        lineBuffer += chunk;
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() ?? ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.trim()) {
            if (options.verbose) {
              // In verbose mode, stream raw text content directly to stdout
              const textContent = parseTextContent(line);
              if (textContent) {
                console.log(textContent);
              } else {
                // Show raw JSON type for debugging if we can't parse content
                try {
                  const parsed = JSON.parse(line);
                  if (parsed.type) {
                    console.log(`[${parsed.type}]`);
                  }
                } catch {
                  // Not JSON
                }
              }
            }

            if (options.onProgress) {
              const toolMessage = parseToolUsage(line);
              if (toolMessage) {
                options.onProgress(toolMessage);
              }
            }
          }
        }
      }
    });

    child.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      if (options.verbose) {
        console.log(`[stderr] ${chunk}`);
      }
    });

    child.on('close', (code) => {
      const sessionId = parseSessionId(stdout);

      resolve({
        sessionId,
        output: stdout,
        exitCode: code ?? 0,
      });
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to run claude CLI: ${err.message}`));
    });
  });
}

/**
 * Check if Claude output contains a specific marker
 */
function containsMarker(output: string, marker: string): boolean {
  // Parse stream-json output and look for the marker in text content
  const lines = output.split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const parsed = JSON.parse(line);

      // Check assistant message text content
      if (parsed.type === 'assistant' && parsed.message?.content) {
        for (const block of parsed.message.content) {
          if (block.type === 'text' && typeof block.text === 'string') {
            if (block.text.includes(marker)) {
              return true;
            }
          }
        }
      }
    } catch {
      // Not valid JSON, check raw text
      if (line.includes(marker)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if Claude output indicates the issue is already fixed
 */
export function isAlreadyFixed(output: string): boolean {
  return containsMarker(output, 'ALREADY_FIXED');
}

/**
 * Check if Claude output indicates the review feedback was not applicable
 * (false positive, wrong codebase, etc.)
 */
export function isReviewNotApplicable(output: string): boolean {
  return containsMarker(output, 'REVIEW_NOT_APPLICABLE');
}

/**
 * Parse session ID from Claude CLI stream-json output
 * The output contains JSON lines, and we look for the session_id field
 */
function parseSessionId(output: string): string {
  const lines = output.split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const parsed = JSON.parse(line);

      // Check for session_id in various locations
      if (parsed.session_id) {
        return parsed.session_id;
      }
      if (parsed.sessionId) {
        return parsed.sessionId;
      }
      // The init message often contains the session ID
      if (parsed.type === 'init' && parsed.session_id) {
        return parsed.session_id;
      }
    } catch {
      // Not JSON, continue
    }
  }

  return '';
}

/**
 * Build the initial fix prompt for an issue
 */
export function buildInitialFixPrompt(issueId: string, issueContent: string): string {
  return `You are fixing a code issue in this codebase.

ISSUE TO FIX (${issueId}):
${issueContent}

INSTRUCTIONS:
1. Run package install commands first (e.g., pnpm install, npm install) - this is a fresh worktree
2. Read the issue carefully to understand the problem
3. Explore the codebase to find the affected files
4. Check if the issue has ALREADY been fixed (code may have changed since the issue was detected)
5. If already fixed, respond with "ALREADY_FIXED" and explain briefly why
6. If not fixed, implement the fix following best practices
7. Run tests if available to verify the fix
8. Before committing, run "git status" and carefully review all modified files
9. ONLY stage files that are DIRECTLY related to fixing this specific issue
10. Commit your changes with a descriptive message

CRITICAL - COMMIT DISCIPLINE:
- ONLY commit files you directly modified to fix this issue
- Do NOT commit unrelated changes (formatting, lock files, config changes, etc.)
- Use "git add <specific-file>" for each relevant file, NOT "git add ."
- Before committing, run "git diff --staged" to verify only relevant changes are staged
- If you accidentally staged unrelated files, use "git reset HEAD <file>" to unstage them

COMMIT MESSAGE FORMAT:
- Start with "fix(${issueId}):" followed by a brief description
- The description should explain WHAT was fixed and WHY
- Example: "fix(${issueId}): Add null check to prevent crash when user data is missing"

IMPORTANT:
- Focus on the specific issue - do not fix unrelated problems
- Make minimal changes necessary to fix the issue
- If the issue is already resolved, respond with "ALREADY_FIXED" - do NOT make any commits
- After committing, respond with "COMMIT_COMPLETE" to signal you're done
- NEVER use credentials from .env files to connect to external systems (databases, APIs, etc.) - only use them for local configuration if needed

CRITICAL - YOU MUST FIX ALL ITEMS IN THE ISSUE:
- You are NOT allowed to skip any part of the issue, especially items marked as "Critical" or "High" severity
- Do NOT make judgment calls about whether a fix is "too risky" or "requires architectural changes"
- Do NOT defer fixes for "backwards compatibility" concerns - the issue has already been vetted
- If the issue says to remove error swallowing, remove it. If it says to fail fast, make it fail fast.
- Your job is to implement what the issue specifies, not to second-guess the requirements
- If you truly cannot implement something (e.g., missing dependencies), respond with "BLOCKED: <reason>" instead of skipping it silently
- Partial fixes are NOT acceptable - either fix everything or report what's blocking you`;
}

/**
 * Build the iteration prompt for addressing review feedback
 */
export function buildIterationPrompt(
  issueId: string,
  actionableItems: Array<{ severity: string; description: string; file?: string }>
): string {
  const itemsList = actionableItems
    .map((item, i) => {
      const fileInfo = item.file ? ` (${item.file})` : '';
      return `${i + 1}. [${item.severity.toUpperCase()}] ${item.description}${fileInfo}`;
    })
    .join('\n');

  return `The code review identified issues that need to be addressed for ${issueId}:

${itemsList}

Please fix these issues and commit the changes.
Focus on "must_fix" items first, then "should_fix" items.

CRITICAL - COMMIT DISCIPLINE:
- ONLY commit files you directly modified to address the review feedback
- Use "git add <specific-file>" for each relevant file, NOT "git add ."
- Before committing, run "git diff --staged" to verify only relevant changes are staged
- Do NOT commit unrelated changes (formatting, lock files, config changes, etc.)

IMPORTANT:
- Make minimal changes to address the feedback
- Your commit message should reference ${issueId} and describe the review fix
- After committing, respond with "COMMIT_COMPLETE" to signal you're done
- If the review feedback is NOT APPLICABLE to your changes (false positive, wrong files, hallucinated issues), respond with "REVIEW_NOT_APPLICABLE" and explain why - do NOT make any commits in this case`;
}
