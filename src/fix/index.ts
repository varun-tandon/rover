/**
 * Main orchestration for the fix workflow
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  FixOptions,
  FixResult,
  FixProgress,
  IssueContext,
  ReviewItem,
} from './types.js';
import { createWorktree, generateUniqueBranchName, removeWorktree } from './worktree.js';
import { runClaude, buildInitialFixPrompt, buildIterationPrompt, isAlreadyFixed, isReviewNotApplicable } from './claude-runner.js';
import { runReview, parseReviewForActionables, hasActionableItems } from './reviewer.js';
import { getTicketPathById } from '../storage/tickets.js';
import { removeIssues } from '../storage/issues.js';
import {
  getOrCreateFixState,
  saveFixState,
  upsertFixRecord,
  type FixRecord,
} from '../storage/fix-state.js';

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract a brief summary from issue content
 * Looks for the first meaningful line (title, heading, or first sentence)
 */
function extractIssueSummary(content: string): string {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  for (const line of lines) {
    // Skip markdown metadata, headers with just symbols
    if (line.startsWith('---') || line.match(/^#+\s*$/)) {
      continue;
    }

    // Clean up markdown headers
    const cleaned = line.replace(/^#+\s*/, '').trim();

    if (cleaned.length > 0) {
      // Truncate if too long (for PR title)
      if (cleaned.length > 100) {
        return cleaned.slice(0, 97) + '...';
      }
      return cleaned;
    }
  }

  return 'Fix issue';
}

/**
 * Load issue context from a ticket file
 */
async function loadIssueContext(
  targetPath: string,
  issueId: string
): Promise<IssueContext> {
  const ticketPath = getTicketPathById(targetPath, issueId);

  if (!ticketPath) {
    throw new Error(`Issue ${issueId} not found`);
  }

  const content = await readFile(ticketPath, 'utf-8');

  return {
    id: issueId,
    content,
    ticketPath,
  };
}

/**
 * Fix a single issue through the full workflow
 */
async function fixSingleIssue(
  issue: IssueContext,
  originalPath: string,
  maxIterations: number,
  verbose: boolean,
  onProgress: (progress: FixProgress) => void
): Promise<FixResult> {
  const startTime = Date.now();
  const resolvedOriginal = resolve(originalPath);

  // Generate branch name
  const baseBranchName = `fix/${issue.id}`;
  let branchName: string;

  try {
    branchName = await generateUniqueBranchName(resolvedOriginal, baseBranchName);
  } catch (error) {
    return {
      issueId: issue.id,
      status: 'error',
      worktreePath: '',
      branchName: baseBranchName,
      iterations: 0,
      error: `Failed to generate branch name: ${error instanceof Error ? error.message : String(error)}`,
      durationMs: Date.now() - startTime,
    };
  }

  // Step 1: Create worktree
  onProgress({
    issueId: issue.id,
    phase: 'worktree',
    iteration: 0,
    maxIterations,
    message: `Creating worktree with branch ${branchName}...`,
  });

  let worktreePath: string;
  try {
    worktreePath = await createWorktree(resolvedOriginal, branchName);
  } catch (error) {
    return {
      issueId: issue.id,
      status: 'error',
      worktreePath: '',
      branchName,
      iterations: 0,
      error: `Failed to create worktree: ${error instanceof Error ? error.message : String(error)}`,
      durationMs: Date.now() - startTime,
    };
  }

  // Step 2-7: Fix and review loop
  let sessionId: string | undefined;
  let lastActionableItems: ReviewItem[] = [];

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    // Step 2: Run Claude to fix
    onProgress({
      issueId: issue.id,
      phase: 'fixing',
      iteration,
      maxIterations,
      message: iteration === 1
        ? 'Claude is analyzing and fixing the issue...'
        : `Claude is addressing review feedback (iteration ${iteration})...`,
    });

    const prompt = iteration === 1
      ? buildInitialFixPrompt(issue.id, issue.content)
      : buildIterationPrompt(issue.id, lastActionableItems);

    let claudeResult;
    let retryCount = 0;

    while (retryCount <= MAX_RETRIES) {
      try {
        claudeResult = await runClaude({
          prompt,
          cwd: worktreePath,
          sessionId,
          verbose,
          onProgress: (msg) => {
            onProgress({
              issueId: issue.id,
              phase: 'fixing',
              iteration,
              maxIterations,
              message: msg,
            });
          },
        });
        break;
      } catch (error) {
        retryCount++;
        if (retryCount > MAX_RETRIES) {
          return {
            issueId: issue.id,
            status: 'error',
            worktreePath,
            branchName,
            iterations: iteration - 1,
            error: `Claude CLI failed: ${error instanceof Error ? error.message : String(error)}`,
            durationMs: Date.now() - startTime,
          };
        }
        await sleep(RETRY_DELAY_MS * retryCount);
      }
    }

    if (!claudeResult) {
      return {
        issueId: issue.id,
        status: 'error',
        worktreePath,
        branchName,
        iterations: iteration - 1,
        error: 'Claude CLI returned no result',
        durationMs: Date.now() - startTime,
      };
    }

    // Save session ID for potential resume
    if (claudeResult.sessionId) {
      sessionId = claudeResult.sessionId;
    }

    // Check if Claude exited with an error
    if (claudeResult.exitCode !== 0) {
      return {
        issueId: issue.id,
        status: 'error',
        worktreePath,
        branchName,
        iterations: iteration,
        error: `Claude CLI exited with code ${claudeResult.exitCode}`,
        durationMs: Date.now() - startTime,
      };
    }

    // Check if Claude determined the issue is already fixed (first iteration only)
    if (iteration === 1 && isAlreadyFixed(claudeResult.output)) {
      onProgress({
        issueId: issue.id,
        phase: 'already_fixed',
        iteration,
        maxIterations,
        message: 'Issue already fixed - removing from issues list',
      });

      // Remove the worktree since no changes were made
      try {
        await removeWorktree(originalPath, worktreePath);
      } catch {
        // Worktree removal failed, but that's okay
      }

      // Remove the issue from the store
      try {
        await removeIssues(originalPath, [issue.id]);
      } catch (err) {
        // Log but don't fail - the issue being already fixed is the important outcome
        console.warn(`Warning: Could not remove issue ${issue.id}: ${err instanceof Error ? err.message : String(err)}`);
      }

      return {
        issueId: issue.id,
        status: 'already_fixed',
        worktreePath: '',
        branchName,
        iterations: iteration,
        durationMs: Date.now() - startTime,
      };
    }

    // Check if Claude determined the review feedback was not applicable (iterations > 1)
    if (iteration > 1 && isReviewNotApplicable(claudeResult.output)) {
      onProgress({
        issueId: issue.id,
        phase: 'complete',
        iteration,
        maxIterations,
        message: `Complete - review feedback not applicable (${iteration} iteration${iteration !== 1 ? 's' : ''})`,
      });

      return {
        issueId: issue.id,
        status: 'success',
        worktreePath,
        branchName,
        iterations: iteration,
        durationMs: Date.now() - startTime,
      };
    }

    // Step 3: Run review
    onProgress({
      issueId: issue.id,
      phase: 'reviewing',
      iteration,
      maxIterations,
      message: 'Running code review...',
    });

    let reviewOutput: string;
    try {
      reviewOutput = await runReview(worktreePath, {
        verbose,
        onProgress: (msg) => {
          onProgress({
            issueId: issue.id,
            phase: 'reviewing',
            iteration,
            maxIterations,
            message: msg,
          });
        },
      });
    } catch (error) {
      // Review failed - treat as needing manual review
      return {
        issueId: issue.id,
        status: 'error',
        worktreePath,
        branchName,
        iterations: iteration,
        error: `Review failed: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - startTime,
      };
    }

    // Step 4: Parse review for actionable items
    const analysis = await parseReviewForActionables(reviewOutput);

    // Step 5: Check if we're done
    if (!hasActionableItems(analysis)) {
      onProgress({
        issueId: issue.id,
        phase: 'complete',
        iteration,
        maxIterations,
        message: `Complete after ${iteration} iteration(s)`,
      });

      return {
        issueId: issue.id,
        status: 'success',
        worktreePath,
        branchName,
        iterations: iteration,
        durationMs: Date.now() - startTime,
      };
    }

    // Step 6: More iterations needed
    const mustFixCount = analysis.items.filter((i) => i.severity === 'must_fix').length;
    const shouldFixCount = analysis.items.filter((i) => i.severity === 'should_fix').length;

    onProgress({
      issueId: issue.id,
      phase: 'iterating',
      iteration,
      maxIterations,
      message: `Review found ${mustFixCount} must-fix, ${shouldFixCount} should-fix items`,
      actionableItems: mustFixCount + shouldFixCount,
    });

    // Save items for next iteration prompt
    lastActionableItems = analysis.items.filter(
      (i) => i.severity === 'must_fix' || i.severity === 'should_fix'
    );
  }

  // Hit iteration limit
  onProgress({
    issueId: issue.id,
    phase: 'complete',
    iteration: maxIterations,
    maxIterations,
    message: `Hit iteration limit (${maxIterations}). Manual review recommended.`,
    actionableItems: lastActionableItems.length,
  });

  return {
    issueId: issue.id,
    status: 'iteration_limit',
    worktreePath,
    branchName,
    iterations: maxIterations,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Run the fix workflow for multiple issues in parallel
 */
export async function runFix(
  options: FixOptions,
  onProgress: (progress: FixProgress) => void
): Promise<FixResult[]> {
  const { targetPath, issueIds, concurrency, maxIterations, verbose } = options;
  const resolvedPath = resolve(targetPath);

  // Load all issues first to validate they exist
  const issues: IssueContext[] = [];
  const errorResults: FixResult[] = [];

  for (const issueId of issueIds) {
    try {
      const issue = await loadIssueContext(resolvedPath, issueId);
      issues.push(issue);
    } catch (error) {
      // Report error for this issue and add to results
      onProgress({
        issueId,
        phase: 'error',
        iteration: 0,
        maxIterations,
        message: `Issue not found: ${issueId}`,
      });
      errorResults.push({
        issueId,
        status: 'error',
        worktreePath: '',
        branchName: '',
        iterations: 0,
        error: `Issue not found: ${issueId}`,
        durationMs: 0,
      });
    }
  }

  if (issues.length === 0) {
    return errorResults;
  }

  // Load or create fix state
  let fixState = await getOrCreateFixState(resolvedPath);

  // Work queue pattern
  const queue = [...issues];
  const results: FixResult[] = [];

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const issue = queue.shift();
      if (!issue) break;

      const result = await fixSingleIssue(
        issue,
        resolvedPath,
        maxIterations,
        verbose,
        onProgress
      );
      results.push(result);

      // Save fix record to state (skip already_fixed since worktree is removed)
      if (result.status !== 'already_fixed' && result.worktreePath) {
        // Extract summary from issue content (first non-empty line or first sentence)
        const issueSummary = extractIssueSummary(issue.content);

        const record: FixRecord = {
          issueId: result.issueId,
          branchName: result.branchName,
          worktreePath: result.worktreePath,
          status: result.status === 'success' || result.status === 'iteration_limit'
            ? 'ready_for_review'
            : 'error',
          iterations: result.iterations,
          startedAt: new Date(Date.now() - result.durationMs).toISOString(),
          completedAt: new Date().toISOString(),
          error: result.error,
          issueContent: issue.content,
          issueSummary,
        };
        fixState = upsertFixRecord(fixState, record);
        await saveFixState(resolvedPath, fixState);
      }
    }
  }

  // Spawn workers up to concurrency limit
  const workerCount = Math.min(concurrency, issues.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);

  // Combine error results (for issues that weren't found) with fix results
  return [...errorResults, ...results];
}
