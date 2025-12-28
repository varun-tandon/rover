/**
 * Git worktree operations for the fix workflow
 * Replicates the gwtenv shell function behavior
 */
/**
 * Create a git worktree for fixing an issue
 * 1. Creates worktree at .rover/{branchName} (gitignored)
 * 2. Copies .env* files (except .env.example)
 * 3. Copies .mcp.json files
 */
export declare function createWorktree(originalPath: string, branchName: string): Promise<string>;
/**
 * Remove a git worktree
 */
export declare function removeWorktree(originalPath: string, worktreePath: string): Promise<void>;
/**
 * Check if a branch already exists
 */
export declare function branchExists(repoPath: string, branchName: string): Promise<boolean>;
/**
 * Generate a unique branch name if the base name already exists
 */
export declare function generateUniqueBranchName(repoPath: string, baseName: string): Promise<string>;
