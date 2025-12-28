import { writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getRoverDir } from './issues.js';
const TICKETS_DIR = 'tickets';
const SEVERITY_FOLDERS = ['critical', 'high', 'medium', 'low'];
export function getTicketsDir(targetPath, severity) {
    const base = join(getRoverDir(targetPath), TICKETS_DIR);
    return severity ? join(base, severity) : base;
}
export async function ensureTicketsDir(targetPath) {
    for (const severity of SEVERITY_FOLDERS) {
        const severityDir = getTicketsDir(targetPath, severity);
        if (!existsSync(severityDir)) {
            await mkdir(severityDir, { recursive: true });
        }
    }
}
async function getNextTicketNumber(targetPath) {
    const ticketNumbers = [];
    for (const severity of SEVERITY_FOLDERS) {
        const severityDir = getTicketsDir(targetPath, severity);
        if (!existsSync(severityDir))
            continue;
        try {
            const files = await readdir(severityDir);
            for (const f of files) {
                if (f.startsWith('ISSUE-') && f.endsWith('.md')) {
                    const match = f.match(/ISSUE-(\d+)\.md/);
                    if (match?.[1]) {
                        const num = parseInt(match[1], 10);
                        if (!isNaN(num))
                            ticketNumbers.push(num);
                    }
                }
            }
        }
        catch (error) {
            // Log unexpected errors for debugging - readdir can fail due to permissions or filesystem issues
            console.error(`Warning: Failed to read tickets from ${severityDir}:`, error);
        }
    }
    return ticketNumbers.length > 0 ? Math.max(...ticketNumbers) + 1 : 1;
}
// 3-digit padding supports up to 999 issues per codebase. Chosen for readability
// in file listings while being sufficient for typical project lifespans.
function formatTicketNumber(num) {
    return `ISSUE-${num.toString().padStart(3, '0')}`;
}
/**
 * Parse a ticket number from a ticket ID string (e.g., "ISSUE-001" -> 1)
 * Returns null if the format is invalid
 */
export function parseTicketNumber(ticketId) {
    const match = ticketId.match(/^ISSUE-(\d+)$/i);
    if (!match?.[1])
        return null;
    return parseInt(match[1], 10);
}
/**
 * Extract ticket ID from a ticket path (e.g., ".rover/tickets/high/ISSUE-001.md" -> "ISSUE-001")
 * Returns null if no ticket ID found
 */
export function extractTicketId(ticketPath) {
    const match = ticketPath.match(/ISSUE-\d+/);
    return match ? match[0] : null;
}
/**
 * Get the path to a ticket file by ticket ID (e.g., "ISSUE-001")
 * Searches across all severity folders
 */
export function getTicketPathById(targetPath, ticketId) {
    const num = parseTicketNumber(ticketId);
    if (num === null)
        return null;
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
export async function deleteTicketFile(targetPath, ticketId) {
    const ticketPath = getTicketPathById(targetPath, ticketId);
    if (!ticketPath)
        return false;
    if (!existsSync(ticketPath)) {
        return false;
    }
    await unlink(ticketPath);
    return true;
}
export function generateTicketMarkdown(issue, ticketId) {
    const markdownLines = [];
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
    }
    else {
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
 * Create a ticket file for an approved issue.
 * Returns both the path and a new issue object with ticketPath set (does not mutate input).
 */
export async function createTicketFile(targetPath, issue) {
    await ensureTicketsDir(targetPath);
    const ticketNum = await getNextTicketNumber(targetPath);
    const ticketId = formatTicketNumber(ticketNum);
    const ticketPath = join(getTicketsDir(targetPath, issue.severity), `${ticketId}.md`);
    // Create a new issue object with ticketPath set (no mutation)
    const updatedIssue = {
        ...issue,
        ticketPath
    };
    const content = generateTicketMarkdown(updatedIssue, ticketId);
    await writeFile(ticketPath, content, 'utf-8');
    return { path: ticketPath, issue: updatedIssue };
}
/**
 * Create ticket files for multiple approved issues.
 * Returns both the paths and new issue objects with ticketPath set (does not mutate inputs).
 */
export async function createTicketFiles(targetPath, issues) {
    const paths = [];
    const updatedIssues = [];
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
export async function getExistingTickets(targetPath) {
    const allTickets = [];
    for (const severity of SEVERITY_FOLDERS) {
        const severityDir = getTicketsDir(targetPath, severity);
        if (!existsSync(severityDir))
            continue;
        try {
            const files = await readdir(severityDir);
            const tickets = files
                .filter(f => f.startsWith('ISSUE-') && f.endsWith('.md'))
                .map(f => join(severityDir, f));
            allTickets.push(...tickets);
        }
        catch (error) {
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
export function generateConsolidatedTicketMarkdown(issue, ticketId, originalIds) {
    const markdownLines = [];
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
    }
    else {
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
export async function createConsolidatedTicketFile(targetPath, issue, originalIds) {
    await ensureTicketsDir(targetPath);
    const ticketNum = await getNextTicketNumber(targetPath);
    const ticketId = formatTicketNumber(ticketNum);
    const ticketPath = join(getTicketsDir(targetPath, issue.severity), `${ticketId}.md`);
    // Create a new issue object with ticketPath set
    const updatedIssue = {
        ...issue,
        ticketPath
    };
    const content = generateConsolidatedTicketMarkdown(updatedIssue, ticketId, originalIds);
    await writeFile(ticketPath, content, 'utf-8');
    return { path: ticketPath, issue: updatedIssue };
}
