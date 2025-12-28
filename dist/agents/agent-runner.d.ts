/**
 * Claude CLI interaction for agent tasks (scanner, checker, planner, etc.)
 *
 * This is a simpler wrapper than claude-runner.ts which is specific to the fix workflow.
 * Agents don't need session management, markers, or iterative loops.
 */
export interface AgentRunnerOptions {
    /** The prompt to send to Claude */
    prompt: string;
    /** Working directory for the CLI */
    cwd: string;
    /** Allowed tools (e.g., ['Glob', 'Grep', 'Read']) */
    allowedTools: string[];
    /** Model to use (defaults to 'sonnet') */
    model?: 'sonnet' | 'opus' | 'haiku';
    /** Progress callback for tool usage updates */
    onProgress?: (message: string) => void;
}
export interface AgentRunnerResult {
    /** The final text result from Claude (extracted from stream-json) */
    resultText: string;
    /** Exit code from CLI */
    exitCode: number;
}
/**
 * Run Claude CLI for agent tasks (scanner, checker, planner, etc.)
 */
export declare function runAgent(options: AgentRunnerOptions): Promise<AgentRunnerResult>;
