import { writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ApprovedIssue, IssueSeverity } from '../types/index.js';
import { getRoverDir } from './issues.js';

const TICKETS_DIR = 'tickets';
const SEVERITY_FOLDERS: IssueSeverity[] = ['critical', 'high', 'medium', 'low'];

export function getTicketsDir(targetPath: string, severity?: IssueSeverity): string {
  const base = join(getRoverDir(targetPath), TICKETS_DIR);
  return severity ? join(base, severity) : base;
}

export async function ensureTicketsDir(targetPath: string): Promise<void> {
  for (const severity of SEVERITY_FOLDERS) {
    const severityDir = getTicketsDir(targetPath, severity);
    if (!existsSync(severityDir)) {
      await mkdir(severityDir, { recursive: true });
    }
  }
}

async function getNextTicketNumber(targetPath: string): Promise<number> {
  const ticketNumbers: number[] = [];

  for (const severity of SEVERITY_FOLDERS) {
    const severityDir = getTicketsDir(targetPath, severity);
    if (!existsSync(severityDir)) continue;

    try {
      const files = await readdir(severityDir);
      for (const f of files) {
        if (f.startsWith('ISSUE-') && f.endsWith('.md')) {
          const match = f.match(/ISSUE-(\d+)\.md/);
          if (match?.[1]) {
            const num = parseInt(match[1], 10);
            if (!isNaN(num)) ticketNumbers.push(num);
          }
        }
      }
    } catch (error) {
      // Log unexpected errors for debugging - readdir can fail due to permissions or filesystem issues
      console.error(`Warning: Failed to read tickets from ${severityDir}:`, error);
    }
  }

  return ticketNumbers.length > 0 ? Math.max(...ticketNumbers) + 1 : 1;
}

// 3-digit padding supports up to 999 issues per codebase. Chosen for readability
// in file listings while being sufficient for typical project lifespans.
function formatTicketNumber(num: number): string {
  return `ISSUE-${num.toString().padStart(3, '0')}`;
}

/**
 * Parse a ticket number from a ticket ID string (e.g., "ISSUE-001" -> 1)
 * Returns null if the format is invalid
 */
export function parseTicketNumber(ticketId: string): number | null {
  const match = ticketId.match(/^ISSUE-(\d+)$/i);
  if (!match?.[1]) return null;
  return parseInt(match[1], 10);
}

/**
 * Extract ticket ID from a ticket path (e.g., ".rover/tickets/high/ISSUE-001.md" -> "ISSUE-001")
 * Returns null if no ticket ID found
 */
export function extractTicketId(ticketPath: string): string | null {
  const match = ticketPath.match(/ISSUE-\d+/);
  return match ? match[0] : null;
}

/**
 * Get the path to a ticket file by ticket ID (e.g., "ISSUE-001")
 * Searches across all severity folders
 */
export function getTicketPathById(targetPath: string, ticketId: string): string | null {
  const num = parseTicketNumber(ticketId);
  if (num === null) return null;
  const normalizedId = formatTicketNumber(num);

  for (const severity of SEVERITY_FOLDERS) {
    const ticketPath = join(getTicketsDir(targetPath, severity), `${normalizedId}.md`);
    if (existsSync(ticketPath)) {
      return ticketPath;
    }
  }

  return null;
}

/**
 * Delete a ticket file by ticket ID.
 * Returns true if deleted, false if file didn't exist.
 */
export async function deleteTicketFile(targetPath: string, ticketId: string): Promise<boolean> {
  const ticketPath = getTicketPathById(targetPath, ticketId);
  if (!ticketPath) return false;

  if (!existsSync(ticketPath)) {
    return false;
  }

  await unlink(ticketPath);
  return true;
}

export function generateTicketMarkdown(
  issue: ApprovedIssue,
  ticketId: string
): string {
  const markdownLines: string[] = [];

  // Header
  markdownLines.push(`# ${ticketId}: ${issue.title}`);
  markdownLines.push('');

  // Metadata
  markdownLines.push(`**Severity**: ${issue.severity.charAt(0).toUpperCase() + issue.severity.slice(1)}`);
  markdownLines.push(`**Category**: ${issue.category}`);
  markdownLines.push(`**Detected by**: ${issue.agentId}`);

  // File location
  if (issue.lineRange) {
    markdownLines.push(`**File**: \`${issue.filePath}:${issue.lineRange.start}-${issue.lineRange.end}\``);
  } else {
    markdownLines.push(`**File**: \`${issue.filePath}\``);
  }

  markdownLines.push('');

  // Description
  markdownLines.push('## Description');
  markdownLines.push('');
  markdownLines.push(issue.description);
  markdownLines.push('');

  // Code snippet if available
  if (issue.codeSnippet) {
    markdownLines.push('## Problematic Code');
    markdownLines.push('');
    markdownLines.push('```typescript');
    markdownLines.push(issue.codeSnippet);
    markdownLines.push('```');
    markdownLines.push('');
  }

  // Recommendation
  markdownLines.push('## Recommendation');
  markdownLines.push('');
  markdownLines.push(issue.recommendation);
  markdownLines.push('');

  // Footer
  markdownLines.push('---');
  const date = new Date(issue.approvedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  markdownLines.push(`*Generated by Rover on ${date}*`);

  return markdownLines.join('\n');
}

/**
 * Result from creating a single ticket file.
 * Contains both the path to the created file and the issue with ticketPath populated.
 */
export interface CreateTicketResult {
  /** Path to the created ticket file */
  path: string;
  /** The issue with ticketPath field populated (original issue is not mutated) */
  issue: ApprovedIssue;
}

/**
 * Create a ticket file for an approved issue.
 * Returns both the path and a new issue object with ticketPath set (does not mutate input).
 */
export async function createTicketFile(
  targetPath: string,
  issue: ApprovedIssue
): Promise<CreateTicketResult> {
  await ensureTicketsDir(targetPath);

  const ticketNum = await getNextTicketNumber(targetPath);
  const ticketId = formatTicketNumber(ticketNum);
  const ticketPath = join(getTicketsDir(targetPath, issue.severity), `${ticketId}.md`);

  // Create a new issue object with ticketPath set (no mutation)
  const updatedIssue: ApprovedIssue = {
    ...issue,
    ticketPath
  };

  const content = generateTicketMarkdown(updatedIssue, ticketId);
  await writeFile(ticketPath, content, 'utf-8');

  return { path: ticketPath, issue: updatedIssue };
}

/**
 * Result from creating multiple ticket files.
 */
export interface CreateTicketFilesResult {
  /** Paths to all created ticket files */
  paths: string[];
  /** Issues with ticketPath fields populated (original issues are not mutated) */
  issues: ApprovedIssue[];
}

/**
 * Create ticket files for multiple approved issues.
 * Returns both the paths and new issue objects with ticketPath set (does not mutate inputs).
 */
export async function createTicketFiles(
  targetPath: string,
  issues: ApprovedIssue[]
): Promise<CreateTicketFilesResult> {
  const paths: string[] = [];
  const updatedIssues: ApprovedIssue[] = [];

  for (const issue of issues) {
    const result = await createTicketFile(targetPath, issue);
    paths.push(result.path);
    updatedIssues.push(result.issue);
  }

  return { paths, issues: updatedIssues };
}

/**
 * Get all existing ticket files from all severity folders
 */
export async function getExistingTickets(targetPath: string): Promise<string[]> {
  const allTickets: string[] = [];

  for (const severity of SEVERITY_FOLDERS) {
    const severityDir = getTicketsDir(targetPath, severity);
    if (!existsSync(severityDir)) continue;

    try {
      const files = await readdir(severityDir);
      const tickets = files
        .filter(f => f.startsWith('ISSUE-') && f.endsWith('.md'))
        .map(f => join(severityDir, f));
      allTickets.push(...tickets);
    } catch (error) {
      // Log unexpected errors for debugging - readdir can fail due to permissions or filesystem issues
      console.error(`Warning: Failed to read tickets from ${severityDir}:`, error);
    }
  }

  return allTickets.sort();
}

/**
 * Generate markdown for a consolidated ticket.
 * Includes references to the original issues that were merged.
 */
export function generateConsolidatedTicketMarkdown(
  issue: ApprovedIssue,
  ticketId: string,
  originalIds: string[]
): string {
  const markdownLines: string[] = [];

  // Header
  markdownLines.push(`# ${ticketId}: ${issue.title}`);
  markdownLines.push('');

  // Metadata
  markdownLines.push(`**Severity**: ${issue.severity.charAt(0).toUpperCase() + issue.severity.slice(1)}`);
  markdownLines.push(`**Category**: ${issue.category}`);
  markdownLines.push(`**Consolidated from**: ${originalIds.join(', ')}`);

  // File location
  if (issue.lineRange) {
    markdownLines.push(`**File**: \`${issue.filePath}:${issue.lineRange.start}-${issue.lineRange.end}\``);
  } else {
    markdownLines.push(`**File**: \`${issue.filePath}\``);
  }

  markdownLines.push('');

  // Description
  markdownLines.push('## Description');
  markdownLines.push('');
  markdownLines.push(issue.description);
  markdownLines.push('');

  // Code snippet if available
  if (issue.codeSnippet) {
    markdownLines.push('## Problematic Code');
    markdownLines.push('');
    markdownLines.push('```typescript');
    markdownLines.push(issue.codeSnippet);
    markdownLines.push('```');
    markdownLines.push('');
  }

  // Recommendation
  markdownLines.push('## Recommendation');
  markdownLines.push('');
  markdownLines.push(issue.recommendation);
  markdownLines.push('');

  // Footer
  markdownLines.push('---');
  const date = new Date(issue.approvedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  markdownLines.push(`*Consolidated by Rover on ${date}*`);

  return markdownLines.join('\n');
}

/**
 * Create a consolidated ticket file for a merged issue.
 * Includes references to the original issues that were merged.
 */
export async function createConsolidatedTicketFile(
  targetPath: string,
  issue: Omit<ApprovedIssue, 'ticketPath'>,
  originalIds: string[]
): Promise<CreateTicketResult> {
  await ensureTicketsDir(targetPath);

  const ticketNum = await getNextTicketNumber(targetPath);
  const ticketId = formatTicketNumber(ticketNum);
  const ticketPath = join(getTicketsDir(targetPath, issue.severity), `${ticketId}.md`);

  // Create a new issue object with ticketPath set
  const updatedIssue: ApprovedIssue = {
    ...issue,
    ticketPath
  };

  const content = generateConsolidatedTicketMarkdown(updatedIssue, ticketId, originalIds);
  await writeFile(ticketPath, content, 'utf-8');

  return { path: ticketPath, issue: updatedIssue };
}
