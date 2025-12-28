import { runAgent } from './agent-runner.js';
import { getAgent } from './definitions/index.js';
/** Default batch size for checking multiple issues at once */
const BATCH_SIZE = 10;
/**
 * Chunk an array into smaller arrays of a given size.
 */
function chunk(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
}
/**
 * Format a single issue for inclusion in the batch prompt.
 */
function formatIssueForBatch(issue, index) {
    return `### Issue ${index + 1}
- ID: ${issue.id}
- Title: ${issue.title}
- Description: ${issue.description}
- Severity: ${issue.severity}
- File: ${issue.filePath}${issue.lineRange ? `:${issue.lineRange.start}-${issue.lineRange.end}` : ''}
- Category: ${issue.category}
- Recommendation: ${issue.recommendation}
${issue.codeSnippet ? `\nCode Snippet:\n\`\`\`\n${issue.codeSnippet}\n\`\`\`` : ''}`;
}
/**
 * Create a batch prompt that validates multiple issues at once.
 */
function createBatchPrompt(issues, agentName, agentDescription) {
    const issuesList = issues.map((issue, i) => formatIssueForBatch(issue, i)).join('\n\n');
    return `You are a code quality checker. Your task is to validate whether detected issues are genuine and worth addressing.

CONTEXT:
- These issues were detected by "${agentName}"
- The scanner's guidelines were: ${agentDescription}

CANDIDATE ISSUES TO REVIEW (${issues.length} issues):

${issuesList}

INSTRUCTIONS:
1. Use the Read tool to examine the actual files and verify each issue exists
2. For each issue, consider whether:
   - The issue is a genuine problem (not a false positive)
   - The severity is appropriate
   - The recommendation makes sense
   - This would actually improve the codebase if fixed

3. Return your decisions as a JSON array with one entry per issue:
{
  "decisions": [
    { "id": "<issue-id>", "approve": true/false, "reasoning": "Brief explanation" },
    { "id": "<issue-id>", "approve": true/false, "reasoning": "Brief explanation" }
  ]
}

Be critical but fair. Approve issues that are genuine and would benefit from being fixed.
Reject issues that are false positives, overly pedantic, or where the fix would cause more harm than good.

IMPORTANT: You MUST return a decision for every issue ID listed above. Include all ${issues.length} issues in your response.

Return ONLY valid JSON. No markdown, no explanations outside the JSON.`;
}
/**
 * Parse the batch response to extract approved/rejected IDs.
 */
function parseBatchResponse(resultText, issueIds) {
    const approvedIds = [];
    const rejectedIds = [];
    const processedIds = new Set();
    try {
        const jsonMatch = resultText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.decisions && Array.isArray(parsed.decisions)) {
                for (const decision of parsed.decisions) {
                    if (decision.id && typeof decision.approve === 'boolean') {
                        processedIds.add(decision.id);
                        if (decision.approve) {
                            approvedIds.push(decision.id);
                        }
                        else {
                            rejectedIds.push(decision.id);
                        }
                    }
                }
            }
        }
    }
    catch {
        // Parse error - will fall through to reject unprocessed
    }
    // Reject any issues that weren't in the response
    for (const id of issueIds) {
        if (!processedIds.has(id)) {
            rejectedIds.push(id);
        }
    }
    return { approvedIds, rejectedIds };
}
/**
 * Run a checker agent to validate candidate issues.
 *
 * The checker reviews all candidate issues by reading the actual source files
 * and deciding whether each issue is genuine and worth addressing.
 *
 * Issues are validated in batches of up to 10 for efficiency.
 *
 * @param options - Configuration for the checker
 * @param options.targetPath - Absolute path to the codebase for reading source files
 * @param options.agentId - ID of the agent that detected the issues (for context)
 * @param options.issues - Array of candidate issues to check
 * @param options.onProgress - Optional callback invoked for batch progress
 * @returns Checking results including approved/rejected issues
 * @throws Error if the specified agent ID is not found
 */
export async function runChecker(options) {
    const { targetPath, agentId, issues, onProgress } = options;
    const agentDef = getAgent(agentId);
    if (!agentDef) {
        throw new Error(`Unknown agent: ${agentId}`);
    }
    const startTime = Date.now();
    const approvedIds = [];
    const rejectedIds = [];
    // Process issues in batches
    const batches = chunk(issues, BATCH_SIZE);
    for (const batch of batches) {
        // Signal start of batch
        onProgress?.(batch.length, false);
        const prompt = createBatchPrompt(batch, agentDef.name, agentDef.description);
        try {
            const result = await runAgent({
                prompt,
                cwd: targetPath,
                allowedTools: ['Read'],
            });
            const batchResult = parseBatchResponse(result.resultText ?? '', batch.map((i) => i.id));
            approvedIds.push(...batchResult.approvedIds);
            rejectedIds.push(...batchResult.rejectedIds);
        }
        catch {
            // On error, reject all issues in the batch
            rejectedIds.push(...batch.map((i) => i.id));
        }
        // Signal end of batch with count
        onProgress?.(batch.length, true);
    }
    const durationMs = Date.now() - startTime;
    return {
        approvedIds,
        rejectedIds,
        durationMs,
    };
}
