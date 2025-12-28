/**
 * Plan storage utilities for work planning feature.
 * Saves work plans with Mermaid diagrams to .rover/plans/
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getRoverDir } from './issues.js';
import { extractTicketId } from './tickets.js';
const PLANS_DIR = 'plans';
/**
 * Get the plans directory path
 */
export function getPlansDir(targetPath) {
    return join(getRoverDir(targetPath), PLANS_DIR);
}
/**
 * Ensure the plans directory exists
 */
export async function ensurePlansDir(targetPath) {
    const plansDir = getPlansDir(targetPath);
    if (!existsSync(plansDir)) {
        await mkdir(plansDir, { recursive: true });
    }
}
/**
 * Generate a plan filename with timestamp
 */
export function generatePlanFilename() {
    const now = new Date();
    const timestamp = now.toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '_')
        .slice(0, 19);
    return `plan-${timestamp}.md`;
}
/**
 * Get severity color for Mermaid styling
 */
function getSeverityColor(severity) {
    switch (severity) {
        case 'critical': return '#f66';
        case 'high': return '#fa0';
        case 'medium': return '#ff9';
        case 'low': return '#9f9';
        default: return '#ccc';
    }
}
/**
 * Sanitize a string for use as a Mermaid node ID
 */
function sanitizeId(str) {
    return str
        .replace(/[^a-zA-Z0-9]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
}
/**
 * Truncate a string to a max length, adding ellipsis if needed
 */
function truncate(str, maxLength) {
    if (str.length <= maxLength)
        return str;
    return str.slice(0, maxLength - 3) + '...';
}
/**
 * Generate a Mermaid flowchart diagram from issues and dependency analysis
 */
export function generateMermaidDiagram(issues, analysis) {
    const lines = ['flowchart TD'];
    // Create a map of issue ID to issue for quick lookup
    const issueMap = new Map();
    for (const issue of issues) {
        const ticketId = extractTicketId(issue.ticketPath);
        if (ticketId) {
            issueMap.set(ticketId, issue);
        }
    }
    // Create subgraphs for parallel groups
    for (let i = 0; i < analysis.parallelGroups.length; i++) {
        const group = analysis.parallelGroups[i];
        if (!group)
            continue;
        const groupId = sanitizeId(group.name || `workstream_${i + 1}`);
        const groupLabel = group.name || `Workstream ${i + 1}`;
        lines.push(`    subgraph ${groupId}["${groupLabel}"]`);
        for (const issueId of group.issueIds) {
            const issue = issueMap.get(issueId);
            const title = issue ? truncate(issue.title, 25) : 'Unknown';
            // Escape quotes in the title for Mermaid
            const escapedTitle = title.replace(/"/g, "'");
            lines.push(`        ${issueId}["${issueId}: ${escapedTitle}"]`);
        }
        lines.push('    end');
        lines.push('');
    }
    // Add any issues not in a parallel group as standalone nodes
    const groupedIds = new Set(analysis.parallelGroups.flatMap(g => g.issueIds));
    for (const issue of issues) {
        const ticketId = extractTicketId(issue.ticketPath);
        if (ticketId && !groupedIds.has(ticketId)) {
            const title = truncate(issue.title, 25).replace(/"/g, "'");
            lines.push(`    ${ticketId}["${ticketId}: ${title}"]`);
        }
    }
    lines.push('');
    // Add dependency arrows
    for (const dep of analysis.dependencies) {
        let arrow;
        switch (dep.type) {
            case 'conflicts':
                arrow = `-.->|conflicts|`;
                break;
            case 'enables':
                arrow = `-->|enables|`;
                break;
            case 'blocks':
            default:
                arrow = `-->|blocks|`;
                break;
        }
        lines.push(`    ${dep.from} ${arrow} ${dep.to}`);
    }
    lines.push('');
    // Add severity styling
    for (const issue of issues) {
        const ticketId = extractTicketId(issue.ticketPath);
        if (ticketId) {
            const color = getSeverityColor(issue.severity);
            lines.push(`    style ${ticketId} fill:${color}`);
        }
    }
    return lines.join('\n');
}
/**
 * Generate the full plan markdown content
 */
function generatePlanMarkdown(plan) {
    const lines = [];
    // Header
    const date = new Date(plan.generatedAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    lines.push(`# Work Plan - Generated ${date}`);
    lines.push('');
    // Priority issues table
    lines.push(`## Priority Issues (${plan.issues.length})`);
    lines.push('');
    lines.push('| Rank | ID | Title | Severity | File |');
    lines.push('|------|-----|-------|----------|------|');
    for (let i = 0; i < plan.issues.length; i++) {
        const issue = plan.issues[i];
        if (!issue)
            continue;
        const ticketId = extractTicketId(issue.ticketPath) ?? issue.id;
        const title = truncate(issue.title, 40);
        const file = truncate(issue.filePath, 30);
        lines.push(`| ${i + 1} | ${ticketId} | ${title} | ${issue.severity} | \`${file}\` |`);
    }
    lines.push('');
    // Dependency analysis summary
    lines.push('## Dependency Analysis');
    lines.push('');
    lines.push(plan.analysis.summary);
    lines.push('');
    // Mermaid diagram
    lines.push('## Work Diagram');
    lines.push('');
    lines.push('```mermaid');
    lines.push(plan.mermaidDiagram);
    lines.push('```');
    lines.push('');
    // Execution order
    lines.push('## Recommended Execution Order');
    lines.push('');
    for (let i = 0; i < plan.analysis.executionOrder.length; i++) {
        const issueId = plan.analysis.executionOrder[i];
        const issue = plan.issues.find(iss => {
            const id = extractTicketId(iss.ticketPath);
            return id === issueId;
        });
        if (issue) {
            const ticketId = extractTicketId(issue.ticketPath) ?? issue.id;
            lines.push(`${i + 1}. **${ticketId}**: ${issue.title}`);
        }
        else if (issueId) {
            lines.push(`${i + 1}. **${issueId}**`);
        }
    }
    lines.push('');
    // Runnable commands - use AI-generated markdown if available
    if (plan.analysis.commandsMarkdown) {
        lines.push(plan.analysis.commandsMarkdown);
        lines.push('');
    }
    else {
        // Fallback to simple command list
        lines.push('## Commands');
        lines.push('');
        lines.push('Run the following commands in order to fix issues sequentially:');
        lines.push('');
        lines.push('```bash');
        for (const issueId of plan.analysis.executionOrder) {
            if (issueId) {
                lines.push(`rover fix ${issueId}`);
            }
        }
        lines.push('```');
        lines.push('');
        lines.push('Or run all at once:');
        lines.push('');
        lines.push('```bash');
        lines.push(`rover fix ${plan.analysis.executionOrder.filter(Boolean).join(' ')}`);
        lines.push('```');
        lines.push('');
    }
    // Parallel groups explanation
    lines.push('## Parallel Workstreams');
    lines.push('');
    lines.push('The following groups of issues can be worked on simultaneously in separate worktrees:');
    lines.push('');
    for (const group of plan.analysis.parallelGroups) {
        lines.push(`### ${group.name}`);
        lines.push('');
        for (const issueId of group.issueIds) {
            lines.push(`- ${issueId}`);
        }
        lines.push('');
    }
    // Conflicts warning
    const conflicts = plan.analysis.dependencies.filter(d => d.type === 'conflicts');
    if (conflicts.length > 0) {
        lines.push('## Conflicts to Avoid');
        lines.push('');
        lines.push('These issue pairs should NOT be worked on simultaneously:');
        lines.push('');
        for (const conflict of conflicts) {
            lines.push(`- **${conflict.from}** and **${conflict.to}**: ${conflict.reason}`);
        }
        lines.push('');
    }
    // Footer
    lines.push('---');
    lines.push('*Generated by Rover*');
    return lines.join('\n');
}
/**
 * Build a complete work plan from issues and analysis
 */
export function buildWorkPlan(issues, analysis) {
    const mermaidDiagram = generateMermaidDiagram(issues, analysis);
    return {
        generatedAt: new Date().toISOString(),
        issues,
        analysis,
        mermaidDiagram
    };
}
/**
 * Save a work plan to the plans directory
 * Returns the path to the saved file
 */
export async function savePlan(targetPath, plan) {
    await ensurePlansDir(targetPath);
    const filename = generatePlanFilename();
    const planPath = join(getPlansDir(targetPath), filename);
    const content = generatePlanMarkdown(plan);
    await writeFile(planPath, content, 'utf-8');
    return planPath;
}
