import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runAgent } from '../agents/agent-runner.js';
import type { IssueStore, ApprovedIssue, IssueSummary, IssueSeverity } from '../types/index.js';
import { deleteTicketFile, parseTicketNumber } from './tickets.js';

const STORE_VERSION = '1.0.0';
const ROVER_DIR = '.rover';
const ISSUES_FILE = 'issues.json';

/**
 * Threshold for when to use LLM summarization vs direct formatting.
 * Below this threshold, direct formatting is clearer and cheaper than LLM summarization.
 * Above it, LLM compression prevents scanner prompts from growing too large while
 * maintaining semantic accuracy for deduplication.
 */
const LLM_SUMMARIZATION_THRESHOLD = 5;

export function getRoverDir(targetPath: string): string {
  return join(targetPath, ROVER_DIR);
}

export function getIssuesPath(targetPath: string): string {
  return join(getRoverDir(targetPath), ISSUES_FILE);
}

function createEmptyStore(): IssueStore {
  return {
    version: STORE_VERSION,
    issues: [],
    lastScanAt: new Date().toISOString()
  };
}

export async function ensureRoverDir(targetPath: string): Promise<void> {
  const roverDir = getRoverDir(targetPath);
  if (!existsSync(roverDir)) {
    await mkdir(roverDir, { recursive: true });
  }
}

export async function loadIssueStore(targetPath: string): Promise<IssueStore> {
  const issuesPath = getIssuesPath(targetPath);

  if (!existsSync(issuesPath)) {
    return createEmptyStore();
  }

  try {
    const content = await readFile(issuesPath, 'utf-8');
    const store = JSON.parse(content) as IssueStore;

    // Validate and migrate if needed
    if (!store.version || !store.issues) {
      return createEmptyStore();
    }

    return store;
  } catch (error) {
    // Only silently return empty store for JSON parsing errors (corrupted file)
    // Propagate filesystem errors (permissions, etc.) for debugging
    if (error instanceof SyntaxError) {
      console.error(`Warning: Failed to parse ${issuesPath}, starting with empty store:`, error.message);
      return createEmptyStore();
    }
    throw error;
  }
}

export async function saveIssueStore(
  targetPath: string,
  store: IssueStore
): Promise<void> {
  await ensureRoverDir(targetPath);
  const issuesPath = getIssuesPath(targetPath);

  const content = JSON.stringify(store, null, 2);
  await writeFile(issuesPath, content, 'utf-8');
}

export async function addApprovedIssues(
  targetPath: string,
  issues: ApprovedIssue[]
): Promise<IssueStore> {
  const store = await loadIssueStore(targetPath);

  // Add new issues (avoiding duplicates by ID)
  const existingIds = new Set(store.issues.map(i => i.id));
  const newIssues = issues.filter(i => !existingIds.has(i.id));

  store.issues.push(...newIssues);
  store.lastScanAt = new Date().toISOString();

  await saveIssueStore(targetPath, store);
  return store;
}

export async function getExistingIssueSummaries(
  targetPath: string
): Promise<IssueSummary[]> {
  const store = await loadIssueStore(targetPath);

  return store.issues.map(issue => ({
    id: issue.id,
    title: issue.title,
    filePath: issue.filePath,
    category: issue.category
  }));
}

export async function isDuplicateIssue(
  targetPath: string,
  title: string,
  filePath: string,
  category: string
): Promise<boolean> {
  const summaries = await getExistingIssueSummaries(targetPath);

  return summaries.some(s =>
    s.title.toLowerCase() === title.toLowerCase() &&
    s.filePath === filePath &&
    s.category === category
  );
}

export async function getIssueStats(targetPath: string): Promise<{
  totalIssues: number;
  byCategory: Partial<Record<string, number>>;
  bySeverity: Partial<Record<IssueSeverity, number>>;
  lastScanAt: string | null;
}> {
  const store = await loadIssueStore(targetPath);

  const byCategory: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};

  for (const issue of store.issues) {
    byCategory[issue.category] = (byCategory[issue.category] ?? 0) + 1;
    bySeverity[issue.severity] = (bySeverity[issue.severity] ?? 0) + 1;
  }

  return {
    totalIssues: store.issues.length,
    byCategory,
    bySeverity,
    lastScanAt: store.issues.length > 0 ? store.lastScanAt : null
  };
}

/**
 * Use an LLM to create a condensed summary of existing issues for deduplication.
 * Groups similar issues and creates short fingerprints that scanners can check against.
 *
 * For small issue counts (<= 5), formats directly without LLM.
 * For larger sets, uses Claude to intelligently compress and group issues.
 *
 * @param targetPath - Path to the target directory containing .rover/issues.json
 * @returns Formatted summary string of existing issues for scanner context
 * @throws Error if ANTHROPIC_API_KEY is not set when LLM summarization is needed
 * @requires ANTHROPIC_API_KEY environment variable must be set for issue counts > 5
 */
export async function summarizeExistingIssues(targetPath: string): Promise<string> {
  const store = await loadIssueStore(targetPath);

  if (store.issues.length === 0) {
    return 'No existing issues detected yet.';
  }

  // For small numbers of issues, just format them directly
  if (store.issues.length <= LLM_SUMMARIZATION_THRESHOLD) {
    const summaryLines = store.issues.map(issue =>
      `- [${issue.category}] "${issue.title}" in ${issue.filePath}${issue.lineRange ? `:${issue.lineRange.start}-${issue.lineRange.end}` : ''}`
    );
    return `Previously detected issues (${store.issues.length} total):\n${summaryLines.join('\n')}`;
  }

  // For larger sets, use LLM to create a condensed summary.
  // Truncate descriptions to 200 chars to balance context preservation with token efficiency.
  // Testing showed 200 chars captures core issue details while keeping summarization costs
  // reasonable for large issue sets (descriptions often contain verbose code examples).
  const issueDetails = store.issues.map(issue => ({
    title: issue.title,
    file: issue.filePath,
    lines: issue.lineRange ? `${issue.lineRange.start}-${issue.lineRange.end}` : null,
    category: issue.category,
    description: issue.description.slice(0, 200)
  }));

  const prompt = `Summarize these ${store.issues.length} code issues into a condensed list for deduplication purposes.
Group similar issues together and create short fingerprints that clearly identify each unique issue.

Format each as: "[Category] short-description (file:lines)"
Group by file when possible. Be concise but preserve enough detail to identify duplicates.

Issues:
${JSON.stringify(issueDetails, null, 2)}

Return ONLY the condensed list, no explanations.`;

  try {
    const result = await runAgent({
      prompt,
      cwd: targetPath,
      allowedTools: [],
      model: 'haiku', // Use haiku for simple summarization tasks
    });

    if (result.resultText) {
      return `Previously detected issues (${store.issues.length} total, summarized):\n${result.resultText}`;
    }
  } catch {
    // Fallback on error
  }

  // Fallback to simple format
  const summaryLines = store.issues.map(issue =>
    `- [${issue.category}] "${issue.title}" in ${issue.filePath}`
  );
  return `Previously detected issues (${store.issues.length} total):\n${summaryLines.join('\n')}`;
}

/**
 * Result of removing issues
 */
export interface RemoveIssuesResult {
  removed: string[];
  notFound: string[];
  errors: Array<{ ticketId: string; error: string }>;
}

/**
 * Result of ignoring issues (marking as "won't fix")
 */
export interface IgnoreIssuesResult {
  ignored: string[];
  notFound: string[];
  errors: Array<{ ticketId: string; error: string }>;
}

/**
 * Severity weights for priority calculation
 */
const SEVERITY_WEIGHTS: Record<IssueSeverity, number> = {
  critical: 40,
  high: 30,
  medium: 20,
  low: 10
};

/**
 * Select the top priority issues from a list.
 * Priority is calculated as: severityWeight * 10 + approvalVotes
 *
 * @param issues - Issues to select from
 * @param count - Number of issues to select (default: 10)
 * @returns Top priority issues sorted by priority descending
 */
export function selectTopPriorityIssues(
  issues: ApprovedIssue[],
  count: number = 10
): ApprovedIssue[] {
  return [...issues]
    .sort((a, b) => {
      const scoreA = SEVERITY_WEIGHTS[a.severity] + a.votes.filter(v => v.approve).length;
      const scoreB = SEVERITY_WEIGHTS[b.severity] + b.votes.filter(v => v.approve).length;
      return scoreB - scoreA;
    })
    .slice(0, count);
}

/**
 * Consolidate multiple issues into a single issue.
 * Atomically removes the original issues and adds the consolidated one.
 *
 * @param targetPath - Path to the target directory
 * @param originalIds - Ticket IDs of issues to remove (e.g., "ISSUE-001")
 * @param consolidated - The new consolidated issue to add
 * @returns Updated issue store
 */
export async function consolidateIssues(
  targetPath: string,
  originalIds: string[],
  consolidated: ApprovedIssue
): Promise<IssueStore> {
  const store = await loadIssueStore(targetPath);

  // Normalize and find issues to remove
  const normalizedIds = originalIds.map(id => normalizeTicketId(id)).filter((id): id is string => id !== null);

  // Remove original issues
  store.issues = store.issues.filter(issue => {
    const ticketId = issue.ticketPath.match(/ISSUE-\d+\.md$/)?.[0]?.replace('.md', '');
    return !ticketId || !normalizedIds.includes(ticketId);
  });

  // Add consolidated issue
  store.issues.push(consolidated);
  store.lastScanAt = new Date().toISOString();

  await saveIssueStore(targetPath, store);

  return store;
}

/**
 * Normalize a ticket ID to standard format (ISSUE-001)
 */
function normalizeTicketId(ticketId: string): string | null {
  const num = parseTicketNumber(ticketId);
  if (num === null) return null;
  return `ISSUE-${num.toString().padStart(3, '0')}`;
}

/**
 * Remove issues by their ticket IDs (e.g., "ISSUE-001", "ISSUE-002")
 * Removes from both issues.json and deletes ticket files
 */
export async function removeIssues(
  targetPath: string,
  ticketIds: string[]
): Promise<RemoveIssuesResult> {
  const store = await loadIssueStore(targetPath);
  const result: RemoveIssuesResult = {
    removed: [],
    notFound: [],
    errors: []
  };

  for (const ticketId of ticketIds) {
    const normalized = normalizeTicketId(ticketId);

    if (normalized === null) {
      result.errors.push({
        ticketId,
        error: `Invalid ticket ID format: ${ticketId}`
      });
      continue;
    }

    // Find the issue by matching ticketPath
    const issueIndex = store.issues.findIndex(issue => {
      const pathMatch = issue.ticketPath.match(/ISSUE-\d+\.md$/);
      if (!pathMatch) return false;
      const issueTicketId = pathMatch[0].replace('.md', '');
      return issueTicketId === normalized;
    });

    if (issueIndex === -1) {
      result.notFound.push(ticketId);
      continue;
    }

    // Remove from store
    store.issues.splice(issueIndex, 1);

    // Delete ticket file (ignore if already deleted)
    try {
      await deleteTicketFile(targetPath, normalized);
    } catch {
      // File deletion failed but we still removed from store
    }

    result.removed.push(ticketId);
  }

  // Save updated store
  await saveIssueStore(targetPath, store);

  return result;
}

/**
 * Mark issues as "won't fix" by their ticket IDs (e.g., "ISSUE-001", "ISSUE-002")
 * Issues remain in the store (for deduplication) but are hidden from the default list
 */
export async function ignoreIssues(
  targetPath: string,
  ticketIds: string[]
): Promise<IgnoreIssuesResult> {
  const store = await loadIssueStore(targetPath);
  const result: IgnoreIssuesResult = {
    ignored: [],
    notFound: [],
    errors: []
  };

  for (const ticketId of ticketIds) {
    const normalized = normalizeTicketId(ticketId);

    if (normalized === null) {
      result.errors.push({
        ticketId,
        error: `Invalid ticket ID format: ${ticketId}`
      });
      continue;
    }

    // Find the issue by matching ticketPath
    const issue = store.issues.find(i => {
      const pathMatch = i.ticketPath.match(/ISSUE-\d+\.md$/);
      if (!pathMatch) return false;
      const issueTicketId = pathMatch[0].replace('.md', '');
      return issueTicketId === normalized;
    });

    if (!issue) {
      result.notFound.push(ticketId);
      continue;
    }

    // Mark as won't fix
    issue.status = 'wont_fix';
    result.ignored.push(ticketId);
  }

  // Save updated store
  await saveIssueStore(targetPath, store);

  return result;
}
