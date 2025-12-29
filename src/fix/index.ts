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
  FixTrace,
  IterationTrace,
  BatchFixOptions,
  BatchFixResult,
  BatchIssueResult,
  BatchFixProgress,
} from './types.js';
import { createWorktree, generateUniqueBranchName, removeWorktree } from './worktree.js';
import { runClaude, buildInitialFixPrompt, buildIterationPrompt, isAlreadyFixed, isReviewNotApplicable, extractDismissalJustification } from './claude-runner.js';
import { runFullReview, parseReviewForActionables, hasActionableItems, verifyReviewDismissal } from './reviewer.js';
import { runValidation, validationPassed, formatValidationErrors } from './validator.js';
import { getTicketPathById } from '../storage/tickets.js';
import { removeIssues } from '../storage/issues.js';
import {
  getOrCreateFixState,
  saveFixState,
  saveFixTrace,
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

  // Initialize trace early so we can capture all outcomes
  const trace: FixTrace = {
    issueId: issue.id,
    startedAt: new Date(startTime).toISOString(),
    iterations: [],
    finalStatus: 'error', // Will be updated on success
  };

  // Helper to save trace and return result
  async function saveTraceAndReturn(result: FixResult): Promise<FixResult> {
    trace.completedAt = new Date().toISOString();
    trace.finalStatus = result.status;
    trace.error = result.error;
    try {
      await saveFixTrace(resolvedOriginal, trace);
    } catch (err) {
      console.warn(`Warning: Could not save trace for ${issue.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return result;
  }

  // Generate branch name
  const baseBranchName = `fix/${issue.id}`;
  let branchName: string;

  try {
    branchName = await generateUniqueBranchName(resolvedOriginal, baseBranchName);
  } catch (error) {
    return saveTraceAndReturn({
      issueId: issue.id,
      status: 'error',
      worktreePath: '',
      branchName: baseBranchName,
      iterations: 0,
      error: `Failed to generate branch name: ${error instanceof Error ? error.message : String(error)}`,
      durationMs: Date.now() - startTime,
    });
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
    return saveTraceAndReturn({
      issueId: issue.id,
      status: 'error',
      worktreePath: '',
      branchName,
      iterations: 0,
      error: `Failed to create worktree: ${error instanceof Error ? error.message : String(error)}`,
      durationMs: Date.now() - startTime,
    });
  }

  // Step 2-7: Fix and review loop
  let sessionId: string | undefined;
  let lastActionableItems: ReviewItem[] = [];

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    // Initialize iteration trace
    const iterationTrace: IterationTrace = {
      iteration,
      startedAt: new Date().toISOString(),
      completedAt: '', // Will be set when iteration completes
      claudeOutput: '',
      claudeExitCode: 0,
      alreadyFixed: false,
      reviewNotApplicable: false,
    };

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
      iterationTrace.completedAt = new Date().toISOString();
      trace.iterations.push(iterationTrace);
      return saveTraceAndReturn({
        issueId: issue.id,
        status: 'error',
        worktreePath,
        branchName,
        iterations: iteration - 1,
        error: 'Claude CLI returned no result',
        durationMs: Date.now() - startTime,
      });
    }

    // Capture Claude result in trace
    iterationTrace.claudeSessionId = claudeResult.sessionId || undefined;
    iterationTrace.claudeOutput = claudeResult.output;
    iterationTrace.claudeExitCode = claudeResult.exitCode;

    // Save session ID for potential resume
    if (claudeResult.sessionId) {
      sessionId = claudeResult.sessionId;
    }

    // Check if Claude exited with an error
    if (claudeResult.exitCode !== 0) {
      iterationTrace.completedAt = new Date().toISOString();
      trace.iterations.push(iterationTrace);
      return saveTraceAndReturn({
        issueId: issue.id,
        status: 'error',
        worktreePath,
        branchName,
        iterations: iteration,
        error: `Claude CLI exited with code ${claudeResult.exitCode}`,
        durationMs: Date.now() - startTime,
      });
    }

    // Check if Claude determined the issue is already fixed (first iteration only)
    if (iteration === 1 && isAlreadyFixed(claudeResult.output)) {
      iterationTrace.alreadyFixed = true;
      iterationTrace.completedAt = new Date().toISOString();
      trace.iterations.push(iterationTrace);

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

      return saveTraceAndReturn({
        issueId: issue.id,
        status: 'already_fixed',
        worktreePath: '',
        branchName,
        iterations: iteration,
        durationMs: Date.now() - startTime,
      });
    }

    // Step 2.5: Run validation (typecheck, build, lint)
    onProgress({
      issueId: issue.id,
      phase: 'fixing',
      iteration,
      maxIterations,
      message: 'Running validation checks (typecheck, build, lint)...',
    });

    const validation = await runValidation(worktreePath, verbose);
    iterationTrace.validation = validation;

    if (!validationPassed(validation)) {
      // Validation failed - run Claude again with the validation errors
      const validationErrors = formatValidationErrors(validation);

      onProgress({
        issueId: issue.id,
        phase: 'fixing',
        iteration,
        maxIterations,
        message: 'Validation failed - asking Claude to fix errors...',
      });

      iterationTrace.completedAt = new Date().toISOString();
      trace.iterations.push(iterationTrace);

      // Continue to next iteration with validation errors
      lastActionableItems = [{
        severity: 'must_fix' as const,
        description: `Fix the following validation errors:\n\n${validationErrors}`,
      }];
      continue;
    }

    // Check if Claude determined the review feedback was not applicable (iterations > 1)
    if (iteration > 1 && isReviewNotApplicable(claudeResult.output)) {
      // Get must_fix items from previous iteration's review
      const previousReview = trace.iterations[iteration - 2]?.review;
      const mustFixItems = (previousReview?.parsedItems ?? []).filter(
        (item: ReviewItem) => item.severity === 'must_fix'
      );

      // If there were must_fix items, verify the dismissal
      if (mustFixItems.length > 0) {
        onProgress({
          issueId: issue.id,
          phase: 'reviewing',
          iteration,
          maxIterations,
          message: 'Verifying review dismissal...',
        });

        const justification = extractDismissalJustification(claudeResult.output);
        const verification = await verifyReviewDismissal(
          mustFixItems,
          justification,
          worktreePath
        );

        if (!verification.allVerified) {
          // Some dismissals were invalid - continue with remaining items
          onProgress({
            issueId: issue.id,
            phase: 'fixing',
            iteration,
            maxIterations,
            message: `${verification.remainingItems.length} review items still need attention`,
          });

          // Set remaining items for the next iteration
          lastActionableItems = verification.remainingItems.map((i: ReviewItem) => ({
            severity: i.severity,
            description: i.description,
            file: i.file,
          }));

          iterationTrace.completedAt = new Date().toISOString();
          trace.iterations.push(iterationTrace);
          continue;
        }
      }

      // All dismissals verified (or no must_fix items) - accept and complete
      iterationTrace.reviewNotApplicable = true;
      iterationTrace.completedAt = new Date().toISOString();
      trace.iterations.push(iterationTrace);

      onProgress({
        issueId: issue.id,
        phase: 'complete',
        iteration,
        maxIterations,
        message: `Complete - review feedback verified as not applicable (${iteration} iteration${iteration !== 1 ? 's' : ''})`,
      });

      return saveTraceAndReturn({
        issueId: issue.id,
        status: 'success',
        worktreePath,
        branchName,
        iterations: iteration,
        durationMs: Date.now() - startTime,
      });
    }

    // Step 3: Run review
    onProgress({
      issueId: issue.id,
      phase: 'reviewing',
      iteration,
      maxIterations,
      message: 'Running code review...',
    });

    let fullReview;
    try {
      fullReview = await runFullReview(worktreePath, {
        verbose,
        issueContent: issue.content,
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
      iterationTrace.completedAt = new Date().toISOString();
      trace.iterations.push(iterationTrace);
      return saveTraceAndReturn({
        issueId: issue.id,
        status: 'error',
        worktreePath,
        branchName,
        iterations: iteration,
        error: `Review failed: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - startTime,
      });
    }

    // Step 4: Parse review for actionable items (parses combined architecture + bug reviews)
    const analysis = await parseReviewForActionables(fullReview.combined);

    // Capture review data in trace
    iterationTrace.review = {
      architectureOutput: fullReview.architectureReview,
      bugOutput: fullReview.bugReview,
      performanceOutput: fullReview.performanceReview,
      completenessOutput: fullReview.completenessReview,
      combinedOutput: fullReview.combined,
      parsedItems: analysis.items,
      actionableCount: analysis.items.filter(
        (i) => i.severity === 'must_fix' || i.severity === 'should_fix'
      ).length,
    };

    // Step 5: Check if we're done
    if (!hasActionableItems(analysis)) {
      iterationTrace.completedAt = new Date().toISOString();
      trace.iterations.push(iterationTrace);

      onProgress({
        issueId: issue.id,
        phase: 'complete',
        iteration,
        maxIterations,
        message: `Complete after ${iteration} iteration(s)`,
      });

      return saveTraceAndReturn({
        issueId: issue.id,
        status: 'success',
        worktreePath,
        branchName,
        iterations: iteration,
        durationMs: Date.now() - startTime,
      });
    }

    // Step 6: More iterations needed - finalize this iteration trace
    iterationTrace.completedAt = new Date().toISOString();
    trace.iterations.push(iterationTrace);

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

  return saveTraceAndReturn({
    issueId: issue.id,
    status: 'iteration_limit',
    worktreePath,
    branchName,
    iterations: maxIterations,
    durationMs: Date.now() - startTime,
  });
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

/**
 * Fix a single issue within a batch (no worktree creation, no review)
 * Returns whether the fix was successful
 */
async function fixIssueInBatch(
  issue: IssueContext,
  worktreePath: string,
  verbose: boolean,
  onProgress: (msg: string) => void
): Promise<BatchIssueResult> {
  const prompt = buildInitialFixPrompt(issue.id, issue.content);

  let retryCount = 0;
  while (retryCount <= MAX_RETRIES) {
    try {
      const claudeResult = await runClaude({
        prompt,
        cwd: worktreePath,
        verbose,
        onProgress,
      });

      if (claudeResult.exitCode !== 0) {
        return {
          issueId: issue.id,
          status: 'error',
          error: `Claude exited with code ${claudeResult.exitCode}`,
        };
      }

      // Check if issue was already fixed
      if (isAlreadyFixed(claudeResult.output)) {
        return {
          issueId: issue.id,
          status: 'skipped',
          error: 'Issue already fixed',
        };
      }

      return {
        issueId: issue.id,
        status: 'success',
      };
    } catch (error) {
      retryCount++;
      if (retryCount > MAX_RETRIES) {
        return {
          issueId: issue.id,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        };
      }
      await sleep(RETRY_DELAY_MS * retryCount);
    }
  }

  return {
    issueId: issue.id,
    status: 'error',
    error: 'Exhausted retries',
  };
}

/**
 * Run batch fix workflow: fix multiple issues on a single branch with one review at the end.
 *
 * Flow:
 * 1. Create single worktree/branch for all issues
 * 2. Fix each issue sequentially (no review between issues)
 * 3. Run single combined review at the end
 * 4. If review has issues, iterate (fix all remaining, review again)
 */
export async function runBatchFix(
  options: BatchFixOptions,
  onProgress: (progress: BatchFixProgress) => void
): Promise<BatchFixResult> {
  const { targetPath, issueIds, maxIterations, verbose } = options;
  const resolvedPath = resolve(targetPath);
  const startTime = Date.now();

  // Load all issues first
  const issues: IssueContext[] = [];
  const loadErrors: BatchIssueResult[] = [];

  for (const issueId of issueIds) {
    try {
      const issue = await loadIssueContext(resolvedPath, issueId);
      issues.push(issue);
    } catch {
      loadErrors.push({
        issueId,
        status: 'error',
        error: `Issue not found: ${issueId}`,
      });
    }
  }

  if (issues.length === 0) {
    return {
      branchName: '',
      worktreePath: '',
      issueResults: loadErrors,
      status: 'error',
      successCount: 0,
      failedCount: loadErrors.length,
      iterations: 0,
      durationMs: Date.now() - startTime,
      error: 'No valid issues to fix',
    };
  }

  // Generate branch name based on first issue
  const firstIssue = issues[0];
  if (!firstIssue) {
    return {
      branchName: '',
      worktreePath: '',
      issueResults: loadErrors,
      status: 'error',
      successCount: 0,
      failedCount: loadErrors.length,
      iterations: 0,
      durationMs: Date.now() - startTime,
      error: 'No valid issues to fix',
    };
  }
  const baseBranchName = `fix/batch-${firstIssue.id}`;
  let branchName: string;

  try {
    branchName = await generateUniqueBranchName(resolvedPath, baseBranchName);
  } catch (error) {
    return {
      branchName: baseBranchName,
      worktreePath: '',
      issueResults: issues.map(i => ({
        issueId: i.id,
        status: 'error' as const,
        error: 'Failed to generate branch name',
      })),
      status: 'error',
      successCount: 0,
      failedCount: issues.length,
      iterations: 0,
      durationMs: Date.now() - startTime,
      error: `Failed to generate branch name: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // Create worktree
  onProgress({
    phase: 'worktree',
    totalIssues: issues.length,
    message: `Creating worktree with branch ${branchName}...`,
  });

  let worktreePath: string;
  try {
    worktreePath = await createWorktree(resolvedPath, branchName);
  } catch (error) {
    return {
      branchName,
      worktreePath: '',
      issueResults: issues.map(i => ({
        issueId: i.id,
        status: 'error' as const,
        error: 'Failed to create worktree',
      })),
      status: 'error',
      successCount: 0,
      failedCount: issues.length,
      iterations: 0,
      durationMs: Date.now() - startTime,
      error: `Failed to create worktree: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // Fix each issue sequentially
  const issueResults: BatchIssueResult[] = [...loadErrors];
  let successCount = 0;
  let combinedIssueContent = '';

  for (const [i, issue] of issues.entries()) {
    onProgress({
      phase: 'fixing',
      currentIssueId: issue.id,
      currentIssueIndex: i + 1,
      totalIssues: issues.length,
      message: `Fixing issue ${i + 1}/${issues.length}: ${issue.id}...`,
    });

    const result = await fixIssueInBatch(
      issue,
      worktreePath,
      verbose,
      (msg) => onProgress({
        phase: 'fixing',
        currentIssueId: issue.id,
        currentIssueIndex: i + 1,
        totalIssues: issues.length,
        message: msg,
      })
    );

    issueResults.push(result);
    if (result.status === 'success') {
      successCount++;
      combinedIssueContent += `\n\n---\n## Issue: ${issue.id}\n${issue.content}`;
    }
  }

  // If no issues were fixed successfully, we're done
  if (successCount === 0) {
    try {
      await removeWorktree(resolvedPath, worktreePath);
    } catch {
      // Ignore cleanup errors
    }

    return {
      branchName,
      worktreePath: '',
      issueResults,
      status: 'error',
      successCount: 0,
      failedCount: issueResults.filter(r => r.status !== 'success').length,
      iterations: 0,
      durationMs: Date.now() - startTime,
      error: 'No issues were successfully fixed',
    };
  }

  // Run validation checks before review
  onProgress({
    phase: 'reviewing',
    totalIssues: issues.length,
    message: 'Running validation checks (typecheck, build, lint)...',
  });

  const initialValidation = await runValidation(worktreePath, verbose);
  if (!validationPassed(initialValidation)) {
    onProgress({
      phase: 'error',
      totalIssues: issues.length,
      message: 'Validation failed after batch fix',
    });

    return {
      branchName,
      worktreePath,
      issueResults,
      status: 'error',
      successCount,
      failedCount: issueResults.filter(r => r.status !== 'success').length,
      iterations: 0,
      durationMs: Date.now() - startTime,
      error: `Validation failed:\n\n${formatValidationErrors(initialValidation)}`,
    };
  }

  // Run combined review at the end
  let lastActionableItems: ReviewItem[] = [];

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    onProgress({
      phase: 'reviewing',
      totalIssues: issues.length,
      message: `Running combined review (iteration ${iteration})...`,
      iteration,
      maxIterations,
    });

    let fullReview;
    try {
      fullReview = await runFullReview(worktreePath, {
        verbose,
        issueContent: combinedIssueContent,
        onProgress: (msg) => onProgress({
          phase: 'reviewing',
          totalIssues: issues.length,
          message: msg,
          iteration,
          maxIterations,
        }),
      });
    } catch (error) {
      // Review failed - still return partial success
      onProgress({
        phase: 'complete',
        totalIssues: issues.length,
        message: `Batch fix complete (review failed: ${error instanceof Error ? error.message : 'unknown'})`,
      });

      return {
        branchName,
        worktreePath,
        issueResults,
        status: successCount === issues.length ? 'success' : 'partial',
        successCount,
        failedCount: issueResults.filter(r => r.status !== 'success').length,
        iterations: iteration,
        durationMs: Date.now() - startTime,
      };
    }

    // Parse review for actionable items
    const analysis = await parseReviewForActionables(fullReview.combined);

    // Check if we're done
    if (!hasActionableItems(analysis)) {
      onProgress({
        phase: 'complete',
        totalIssues: issues.length,
        message: `Batch fix complete after ${iteration} iteration(s). ${successCount}/${issues.length} issues fixed.`,
      });

      // Save fix state for each successful issue
      let fixState = await getOrCreateFixState(resolvedPath);
      for (const issue of issues) {
        const result = issueResults.find(r => r.issueId === issue.id);
        if (result?.status === 'success') {
          const record: FixRecord = {
            issueId: issue.id,
            branchName,
            worktreePath,
            status: 'ready_for_review',
            iterations: iteration,
            startedAt: new Date(startTime).toISOString(),
            completedAt: new Date().toISOString(),
            issueContent: issue.content,
            issueSummary: extractIssueSummary(issue.content),
          };
          fixState = upsertFixRecord(fixState, record);
        }
      }
      await saveFixState(resolvedPath, fixState);

      return {
        branchName,
        worktreePath,
        issueResults,
        status: successCount === issues.length ? 'success' : 'partial',
        successCount,
        failedCount: issueResults.filter(r => r.status !== 'success').length,
        iterations: iteration,
        durationMs: Date.now() - startTime,
      };
    }

    // Need another iteration - run Claude to address feedback
    if (iteration < maxIterations) {
      onProgress({
        phase: 'fixing',
        totalIssues: issues.length,
        message: `Addressing ${analysis.items.length} review items...`,
        iteration,
        maxIterations,
      });

      const iterationPrompt = buildIterationPrompt('batch', analysis.items.filter(
        i => i.severity === 'must_fix' || i.severity === 'should_fix'
      ));

      try {
        await runClaude({
          prompt: iterationPrompt,
          cwd: worktreePath,
          verbose,
          onProgress: (msg) => onProgress({
            phase: 'fixing',
            totalIssues: issues.length,
            message: msg,
            iteration,
            maxIterations,
          }),
        });
      } catch {
        // Continue to next review even if this fails
      }

      // Run validation after addressing feedback
      onProgress({
        phase: 'fixing',
        totalIssues: issues.length,
        message: 'Running validation checks...',
        iteration,
        maxIterations,
      });

      const validation = await runValidation(worktreePath, verbose);
      if (!validationPassed(validation)) {
        // Validation failed - this counts as an actionable item for next iteration
        onProgress({
          phase: 'fixing',
          totalIssues: issues.length,
          message: 'Validation failed - will retry in next iteration',
          iteration,
          maxIterations,
        });

        lastActionableItems = [{
          severity: 'must_fix' as const,
          description: `Fix the following validation errors:\n\n${formatValidationErrors(validation)}`,
        }];
        continue;
      }

      lastActionableItems = analysis.items.filter(
        i => i.severity === 'must_fix' || i.severity === 'should_fix'
      );
    }
  }

  // Hit iteration limit
  onProgress({
    phase: 'complete',
    totalIssues: issues.length,
    message: `Batch fix complete (hit iteration limit). ${successCount}/${issues.length} issues fixed.`,
  });

  // Save fix state
  let fixState = await getOrCreateFixState(resolvedPath);
  for (const issue of issues) {
    const result = issueResults.find(r => r.issueId === issue.id);
    if (result?.status === 'success') {
      const record: FixRecord = {
        issueId: issue.id,
        branchName,
        worktreePath,
        status: 'ready_for_review',
        iterations: maxIterations,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
        issueContent: issue.content,
        issueSummary: extractIssueSummary(issue.content),
      };
      fixState = upsertFixRecord(fixState, record);
    }
  }
  await saveFixState(resolvedPath, fixState);

  return {
    branchName,
    worktreePath,
    issueResults,
    status: successCount === issues.length ? 'success' : 'partial',
    successCount,
    failedCount: issueResults.filter(r => r.status !== 'success').length,
    iterations: maxIterations,
    durationMs: Date.now() - startTime,
  };
}
