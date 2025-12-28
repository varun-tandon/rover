/**
 * Claude CLI interaction for agent tasks (scanner, voter, planner, etc.)
 *
 * This is a simpler wrapper than claude-runner.ts which is specific to the fix workflow.
 * Agents don't need session management, markers, or iterative loops.
 */
import { spawn } from 'node:child_process';
/**
 * Extract all text content from stream-json output
 */
function extractResultText(output) {
    const lines = output.split('\n');
    const textParts = [];
    for (const line of lines) {
        if (!line.trim())
            continue;
        try {
            const parsed = JSON.parse(line);
            if (parsed.type === 'assistant' && parsed.message?.content) {
                for (const block of parsed.message.content) {
                    if (block.type === 'text' && block.text) {
                        textParts.push(String(block.text));
                    }
                }
            }
        }
        catch {
            // Not valid JSON, skip
        }
    }
    return textParts.join('\n');
}
/**
 * Parse a stream-json line for tool usage (for progress callbacks)
 */
function parseToolUsage(line) {
    try {
        const parsed = JSON.parse(line);
        if (parsed.type === 'assistant' && parsed.message?.content) {
            for (const block of parsed.message.content) {
                if (block.type === 'tool_use' && block.name) {
                    const toolName = block.name;
                    const input = block.input ?? {};
                    switch (toolName) {
                        case 'Read':
                            return `Reading: ${input['file_path'] ?? 'file'}`;
                        case 'Glob':
                            return `Searching for files: ${input['pattern'] ?? 'files'}`;
                        case 'Grep':
                            return `Searching for: ${input['pattern'] ?? 'pattern'}`;
                        default:
                            return `Using ${toolName}`;
                    }
                }
            }
        }
    }
    catch {
        // Not valid JSON
    }
    return null;
}
/**
 * Run Claude CLI for agent tasks (scanner, voter, planner, etc.)
 */
export async function runAgent(options) {
    const { prompt, cwd, allowedTools, model = 'opus', onProgress } = options;
    const args = [
        '--print',
        '--output-format', 'stream-json',
        '--verbose',
        '--permission-mode', 'bypassPermissions',
        '--model', model,
    ];
    if (allowedTools.length > 0) {
        args.push('--allowedTools', allowedTools.join(','));
    }
    return new Promise((resolve, reject) => {
        const child = spawn('claude', args, {
            cwd,
            env: process.env,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        // Handle stdin errors (EPIPE if child dies before/during write)
        child.stdin.on('error', (err) => {
            // EPIPE means child died - we'll handle it in 'close' event
            if (err.code !== 'EPIPE') {
                reject(new Error(`Failed to write to claude CLI: ${err.message}`));
            }
        });
        // Write prompt to stdin and close it
        child.stdin.write(prompt);
        child.stdin.end();
        let stdout = '';
        let lineBuffer = '';
        child.stdout.on('data', (data) => {
            const chunk = data.toString();
            stdout += chunk;
            // Parse for progress updates
            if (onProgress) {
                lineBuffer += chunk;
                const lines = lineBuffer.split('\n');
                lineBuffer = lines.pop() ?? '';
                for (const line of lines) {
                    if (line.trim()) {
                        const toolMessage = parseToolUsage(line);
                        if (toolMessage) {
                            onProgress(toolMessage);
                        }
                    }
                }
            }
        });
        child.stderr.on('data', () => {
            // Silently consume stderr
        });
        // Handle stdout/stderr errors (EPIPE if pipes break)
        child.stdout.on('error', () => {
            // Ignore - handled in 'close' event
        });
        child.stderr.on('error', () => {
            // Ignore - handled in 'close' event
        });
        child.on('close', (code) => {
            resolve({
                resultText: extractResultText(stdout),
                exitCode: code ?? 0,
            });
        });
        child.on('error', (err) => {
            reject(new Error(`Failed to run claude CLI: ${err.message}`));
        });
    });
}
