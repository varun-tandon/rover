import type { ApprovedIssue, IssueSeverity } from '../types/index.js';
export declare function getTicketsDir(targetPath: string, severity?: IssueSeverity): string;
export declare function ensureTicketsDir(targetPath: string): Promise<void>;
/**
 * Parse a ticket number from a ticket ID string (e.g., "ISSUE-001" -> 1)
 * Returns null if the format is invalid
 */
export declare function parseTicketNumber(ticketId: string): number | null;
/**
 * Extract ticket ID from a ticket path (e.g., ".rover/tickets/high/ISSUE-001.md" -> "ISSUE-001")
 * Returns null if no ticket ID found
 */
export declare function extractTicketId(ticketPath: string): string | null;
/**
 * Get the path to a ticket file by ticket ID (e.g., "ISSUE-001")
 * Searches across all severity folders
 */
export declare function getTicketPathById(targetPath: string, ticketId: string): string | null;
/**
 * Delete a ticket file by ticket ID.
 * Returns true if deleted, false if file didn't exist.
 */
export declare function deleteTicketFile(targetPath: string, ticketId: string): Promise<boolean>;
export declare function generateTicketMarkdown(issue: ApprovedIssue, ticketId: string): string;
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
export declare function createTicketFile(targetPath: string, issue: ApprovedIssue): Promise<CreateTicketResult>;
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
export declare function createTicketFiles(targetPath: string, issues: ApprovedIssue[]): Promise<CreateTicketFilesResult>;
/**
 * Get all existing ticket files from all severity folders
 */
export declare function getExistingTickets(targetPath: string): Promise<string[]>;
/**
 * Generate markdown for a consolidated ticket.
 * Includes references to the original issues that were merged.
 */
export declare function generateConsolidatedTicketMarkdown(issue: ApprovedIssue, ticketId: string, originalIds: string[]): string;
/**
 * Create a consolidated ticket file for a merged issue.
 * Includes references to the original issues that were merged.
 */
export declare function createConsolidatedTicketFile(targetPath: string, issue: Omit<ApprovedIssue, 'ticketPath'>, originalIds: string[]): Promise<CreateTicketResult>;
