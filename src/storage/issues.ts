import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { IssueStore, ApprovedIssue, IssueSummary } from '../types/index.js';

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

/**
 * Get the path to the .rover directory for a target path
 */
export function getRoverDir(targetPath: string): string {
  return join(targetPath, ROVER_DIR);
}

/**
 * Get the path to the issues.json file
 */
export function getIssuesPath(targetPath: string): string {
  return join(getRoverDir(targetPath), ISSUES_FILE);
}

/**
 * Create an empty issue store
 */
function createEmptyStore(): IssueStore {
  return {
    version: STORE_VERSION,
    issues: [],
    lastScanAt: new Date().toISOString()
  };
}

/**
 * Ensure the .rover directory exists
 */
export async function ensureRoverDir(targetPath: string): Promise<void> {
  const roverDir = getRoverDir(targetPath);
  if (!existsSync(roverDir)) {
    await mkdir(roverDir, { recursive: true });
  }
}

/**
 * Load the issue store from disk
 */
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
  } catch {
    return createEmptyStore();
  }
}

/**
 * Save the issue store to disk
 */
export async function saveIssueStore(
  targetPath: string,
  store: IssueStore
): Promise<void> {
  await ensureRoverDir(targetPath);
  const issuesPath = getIssuesPath(targetPath);

  const content = JSON.stringify(store, null, 2);
  await writeFile(issuesPath, content, 'utf-8');
}

/**
 * Add new approved issues to the store
 */
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

/**
 * Get summaries of existing issues for deduplication
 */
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

/**
 * Format existing issues as a summary string for the scanner agent
 */
export async function getExistingIssuesSummaryText(
  targetPath: string
): Promise<string> {
  const summaries = await getExistingIssueSummaries(targetPath);

  if (summaries.length === 0) {
    return 'No existing issues detected yet.';
  }

  const lines = summaries.map(s =>
    `- [${s.category}] ${s.title} (${s.filePath})`
  );

  return `Previously detected issues (${summaries.length} total):\n${lines.join('\n')}`;
}

/**
 * Check if an issue with similar characteristics already exists
 */
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

/**
 * Get statistics about the issue store
 */
export async function getIssueStats(targetPath: string): Promise<{
  totalIssues: number;
  byCategory: Record<string, number>;
  bySeverity: Record<string, number>;
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
 */
export async function summarizeExistingIssues(targetPath: string): Promise<string> {
  const store = await loadIssueStore(targetPath);

  if (store.issues.length === 0) {
    return 'No existing issues detected yet.';
  }

  // For small numbers of issues, just format them directly
  if (store.issues.length <= LLM_SUMMARIZATION_THRESHOLD) {
    const lines = store.issues.map(issue =>
      `- [${issue.category}] "${issue.title}" in ${issue.filePath}${issue.lineRange ? `:${issue.lineRange.start}-${issue.lineRange.end}` : ''}`
    );
    return `Previously detected issues (${store.issues.length} total):\n${lines.join('\n')}`;
  }

  // For larger sets, use LLM to create a condensed summary
  const issueDetails = store.issues.map(issue => ({
    title: issue.title,
    file: issue.filePath,
    lines: issue.lineRange ? `${issue.lineRange.start}-${issue.lineRange.end}` : null,
    category: issue.category,
    description: issue.description.slice(0, 200) // Truncate long descriptions
  }));

  const client = new Anthropic();

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `Summarize these ${store.issues.length} code issues into a condensed list for deduplication purposes.
Group similar issues together and create short fingerprints that clearly identify each unique issue.

Format each as: "[Category] short-description (file:lines)"
Group by file when possible. Be concise but preserve enough detail to identify duplicates.

Issues:
${JSON.stringify(issueDetails, null, 2)}

Return ONLY the condensed list, no explanations.`
      }
    ]
  });

  const summaryBlock = response.content.find(block => block.type === 'text');
  if (!summaryBlock || summaryBlock.type !== 'text') {
    // Fallback to simple format
    const lines = store.issues.map(issue =>
      `- [${issue.category}] "${issue.title}" in ${issue.filePath}`
    );
    return `Previously detected issues (${store.issues.length} total):\n${lines.join('\n')}`;
  }

  return `Previously detected issues (${store.issues.length} total, summarized):\n${summaryBlock.text}`;
}
