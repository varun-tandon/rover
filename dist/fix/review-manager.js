/**
 * Review manager for listing completed fixes and creating PRs
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadFixState, saveFixState, updateFixStatus, removeFixRecord, getFixesReadyForReview, } from '../storage/fix-state.js';
import { removeIssues } from '../storage/issues.js';
/**
 * Execute a git command and return stdout
 */
async function execGit(args, cwd) {
    return new Promise((resolve) => {
        const child = spawn('git', args, { cwd });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        child.on('close', (code) => {
            resolve({ stdout, stderr, code: code ?? 0 });
        });
        child.on('error', (err) => {
            resolve({ stdout: '', stderr: err.message, code: 1 });
        });
    });
}
/**
 * Execute gh CLI command
 */
async function execGh(args, cwd) {
    return new Promise((resolve) => {
        const child = spawn('gh', args, { cwd });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        child.on('close', (code) => {
            resolve({ stdout, stderr, code: code ?? 0 });
        });
        child.on('error', (err) => {
            resolve({ stdout: '', stderr: err.message, code: 1 });
        });
    });
}
/**
 * Get the default branch name
 */
async function getDefaultBranch(repoPath) {
    const result = await execGit(['symbolic-ref', 'refs/remotes/origin/HEAD'], repoPath);
    if (result.code === 0 && result.stdout.trim()) {
        const branch = result.stdout.trim().split('/').pop() ?? 'main';
        return branch;
    }
    return 'main';
}
/**
 * Check if worktree still exists
 */
function worktreeExists(worktreePath) {
    return existsSync(worktreePath);
}
/**
 * Get commit summary for a branch
 */
async function getCommitSummary(worktreePath, defaultBranch) {
    const result = await execGit(['log', '--oneline', `${defaultBranch}..HEAD`], worktreePath);
    if (result.code === 0) {
        return result.stdout.trim();
    }
    return '';
}
/**
 * Generate a meaningful PR title from issue summary
 */
function generatePRTitle(issueId, issueSummary) {
    if (issueSummary && issueSummary.length > 0) {
        // Ensure it starts with lowercase after the prefix for conventional commit style
        const summary = issueSummary.charAt(0).toLowerCase() + issueSummary.slice(1);
        // Remove trailing period if present
        const cleanSummary = summary.replace(/\.+$/, '');
        return `fix(${issueId}): ${cleanSummary}`;
    }
    return `fix(${issueId}): Address reported issue`;
}
/**
 * Generate a meaningful PR body from issue content
 */
function generatePRBody(issueId, issueContent, commitSummary) {
    const sections = [];
    // Summary section
    sections.push('## Summary');
    if (issueContent) {
        // Extract a brief description (first paragraph or first few lines)
        const lines = issueContent.split('\n');
        const descriptionLines = [];
        let inDescription = false;
        for (const line of lines) {
            const trimmed = line.trim();
            // Skip markdown frontmatter
            if (trimmed === '---') {
                inDescription = !inDescription;
                continue;
            }
            // Skip if we're in frontmatter
            if (!inDescription && trimmed.startsWith('---'))
                continue;
            // Skip empty lines at the start
            if (descriptionLines.length === 0 && trimmed === '')
                continue;
            // Stop at the first empty line after getting content, or after 5 lines
            if (descriptionLines.length > 0 && trimmed === '')
                break;
            if (descriptionLines.length >= 5)
                break;
            // Clean up markdown headers for the summary
            const cleaned = trimmed.replace(/^#+\s*/, '');
            if (cleaned.length > 0) {
                descriptionLines.push(cleaned);
            }
        }
        if (descriptionLines.length > 0) {
            sections.push(descriptionLines.join('\n'));
        }
        else {
            sections.push(`Fixes ${issueId}.`);
        }
    }
    else {
        sections.push(`Fixes ${issueId}.`);
    }
    // Changes section
    if (commitSummary && commitSummary.length > 0) {
        sections.push('');
        sections.push('## Changes');
        sections.push('```');
        sections.push(commitSummary);
        sections.push('```');
    }
    // Test plan section
    sections.push('');
    sections.push('## Test Plan');
    sections.push('- [ ] Review the changes');
    sections.push('- [ ] Run tests');
    sections.push('- [ ] Verify the fix addresses the issue');
    // Original issue section (full text in collapsible)
    if (issueContent) {
        sections.push('');
        sections.push('<details>');
        sections.push('<summary>Original Issue</summary>');
        sections.push('');
        sections.push(issueContent);
        sections.push('');
        sections.push('</details>');
    }
    // Footer
    sections.push('');
    sections.push('---');
    sections.push('Generated by [Rover](https://github.com/varun-tandon/rover)');
    return sections.join('\n');
}
/**
 * List all fixes with their current status
 */
export async function listFixes(targetPath) {
    const resolvedPath = resolve(targetPath);
    const state = await loadFixState(resolvedPath);
    if (!state) {
        return {
            fixes: [],
            totalCount: 0,
            readyCount: 0,
            prCreatedCount: 0,
            errorCount: 0,
        };
    }
    // Filter out fixes where worktree no longer exists
    const validFixes = state.fixes.filter((fix) => {
        if (fix.status === 'merged')
            return true; // Keep merged for history
        return worktreeExists(fix.worktreePath);
    });
    const readyCount = validFixes.filter((f) => f.status === 'ready_for_review').length;
    const prCreatedCount = validFixes.filter((f) => f.status === 'pr_created').length;
    const errorCount = validFixes.filter((f) => f.status === 'error').length;
    return {
        fixes: validFixes,
        totalCount: validFixes.length,
        readyCount,
        prCreatedCount,
        errorCount,
    };
}
/**
 * Get detailed info about a specific fix
 */
export async function getFixDetails(targetPath, issueId) {
    const resolvedPath = resolve(targetPath);
    const state = await loadFixState(resolvedPath);
    if (!state) {
        return { fix: null, commitSummary: '', defaultBranch: 'main' };
    }
    const fix = state.fixes.find((f) => f.issueId === issueId);
    if (!fix) {
        return { fix: null, commitSummary: '', defaultBranch: 'main' };
    }
    const defaultBranch = await getDefaultBranch(resolvedPath);
    let commitSummary = '';
    if (worktreeExists(fix.worktreePath)) {
        commitSummary = await getCommitSummary(fix.worktreePath, defaultBranch);
    }
    return { fix, commitSummary, defaultBranch };
}
/**
 * Push a branch to remote
 */
async function pushBranch(worktreePath, branchName) {
    const result = await execGit(['push', '-u', 'origin', branchName], worktreePath);
    if (result.code !== 0) {
        return { success: false, error: result.stderr };
    }
    return { success: true };
}
/**
 * Create a PR for a fix using gh CLI
 */
export async function createPR(targetPath, issueId, options) {
    const log = options?.onLog ?? (() => { });
    const resolvedPath = resolve(targetPath);
    log(`Loading fix state...`);
    const state = await loadFixState(resolvedPath);
    if (!state) {
        return { success: false, issueId, error: 'No fix state found' };
    }
    const fix = state.fixes.find((f) => f.issueId === issueId);
    if (!fix) {
        return { success: false, issueId, error: `Fix not found: ${issueId}` };
    }
    if (!worktreeExists(fix.worktreePath)) {
        return { success: false, issueId, error: `Worktree not found: ${fix.worktreePath}` };
    }
    if (fix.status === 'pr_created' && fix.prUrl) {
        return {
            success: true,
            issueId,
            prUrl: fix.prUrl,
            prNumber: fix.prNumber,
            error: 'PR already exists',
        };
    }
    // Push branch to remote first
    log(`Pushing branch ${fix.branchName} to origin...`);
    const pushResult = await pushBranch(fix.worktreePath, fix.branchName);
    if (!pushResult.success) {
        return { success: false, issueId, error: `Failed to push: ${pushResult.error}` };
    }
    // Get commit summary for PR body
    log(`Getting commit summary...`);
    const defaultBranch = await getDefaultBranch(resolvedPath);
    const commitSummary = await getCommitSummary(fix.worktreePath, defaultBranch);
    // Create PR title and body using issue content if available
    const prTitle = options?.title ?? generatePRTitle(issueId, fix.issueSummary);
    const prBody = options?.body ?? generatePRBody(issueId, fix.issueContent, commitSummary);
    const title = prTitle;
    const body = prBody;
    // Create PR using gh CLI
    const ghArgs = [
        'pr', 'create',
        '--title', title,
        '--body', body,
        '--base', defaultBranch,
        '--head', fix.branchName,
    ];
    if (options?.draft) {
        ghArgs.push('--draft');
    }
    log(`Creating PR via gh CLI...`);
    const result = await execGh(ghArgs, fix.worktreePath);
    if (result.code !== 0) {
        return { success: false, issueId, error: `Failed to create PR: ${result.stderr}` };
    }
    // Parse PR URL from output
    const prUrl = result.stdout.trim();
    const prNumberMatch = prUrl.match(/\/pull\/(\d+)/);
    const prNumber = prNumberMatch?.[1] ? parseInt(prNumberMatch[1], 10) : undefined;
    // Update fix state
    log(`Saving fix state...`);
    const newState = updateFixStatus(state, issueId, 'pr_created', {
        prUrl,
        prNumber,
    });
    await saveFixState(resolvedPath, newState);
    // Remove issue from the issues list now that PR is created
    await removeIssues(resolvedPath, [issueId]);
    log(`Done!`);
    return { success: true, issueId, prUrl, prNumber };
}
/**
 * Create PRs for all fixes ready for review
 */
export async function createAllPRs(targetPath, options) {
    const resolvedPath = resolve(targetPath);
    const state = await loadFixState(resolvedPath);
    if (!state) {
        return [];
    }
    const readyFixes = getFixesReadyForReview(state);
    const results = [];
    for (const fix of readyFixes) {
        const result = await createPR(resolvedPath, fix.issueId, {
            draft: options?.draft,
            onLog: options?.onLog,
        });
        results.push(result);
        options?.onProgress?.(fix.issueId, result);
    }
    return results;
}
/**
 * Clean up a fix (remove worktree and record)
 */
export async function cleanupFix(targetPath, issueId) {
    const resolvedPath = resolve(targetPath);
    const state = await loadFixState(resolvedPath);
    if (!state) {
        return { success: false, error: 'No fix state found' };
    }
    const fix = state.fixes.find((f) => f.issueId === issueId);
    if (!fix) {
        return { success: false, error: `Fix not found: ${issueId}` };
    }
    // Remove worktree if it exists
    if (worktreeExists(fix.worktreePath)) {
        const result = await execGit(['worktree', 'remove', '--force', fix.worktreePath], resolvedPath);
        if (result.code !== 0) {
            return { success: false, error: `Failed to remove worktree: ${result.stderr}` };
        }
    }
    // Remove from state
    const newState = removeFixRecord(state, issueId);
    await saveFixState(resolvedPath, newState);
    return { success: true };
}
/**
 * Clean up all fixes (remove worktrees and records)
 */
export async function cleanupAllFixes(targetPath, options) {
    const resolvedPath = resolve(targetPath);
    const state = await loadFixState(resolvedPath);
    if (!state || state.fixes.length === 0) {
        return [];
    }
    const results = [];
    for (const fix of state.fixes) {
        options?.onLog?.(`Cleaning up ${fix.issueId}...`);
        const result = await cleanupFix(resolvedPath, fix.issueId);
        const cleanupResult = {
            success: result.success,
            issueId: fix.issueId,
            error: result.error,
        };
        results.push(cleanupResult);
        options?.onProgress?.(fix.issueId, cleanupResult);
    }
    return results;
}
