/**
 * Git worktree operations for the fix workflow
 * Replicates the gwtenv shell function behavior
 */

import { spawn } from 'node:child_process';
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join, basename, resolve } from 'node:path';

/**
 * Execute a git command and return the result
 */
async function execGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`git ${args.join(' ')} failed: ${stderr || stdout}`));
      }
    });

    child.on('error', reject);
  });
}

/**
 * Recursively find files matching a predicate
 */
async function findFiles(
  dir: string,
  predicate: (name: string) => boolean,
  results: string[] = []
): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      // Skip node_modules, .git, and other common directories
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === '.rover') {
          continue;
        }
        await findFiles(fullPath, predicate, results);
      } else if (entry.isFile() && predicate(entry.name)) {
        results.push(fullPath);
      }
    }
  } catch {
    // Ignore permission errors and missing directories
  }

  return results;
}

/**
 * Copy files from source to destination, preserving relative paths
 */
async function copyFilesPreservingStructure(
  files: string[],
  sourceRoot: string,
  destRoot: string
): Promise<void> {
  for (const file of files) {
    const relativePath = file.slice(sourceRoot.length + 1);
    const destPath = join(destRoot, relativePath);
    const destDir = dirname(destPath);

    try {
      await mkdir(destDir, { recursive: true });
      await copyFile(file, destPath);
    } catch (error) {
      // Log warning but continue - missing env files shouldn't block worktree creation
      console.warn(
        `Warning: Failed to copy ${relativePath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

/**
 * Create a git worktree for fixing an issue
 * 1. Creates worktree at .rover/{branchName} (gitignored)
 * 2. Copies .env* files (except .env.example)
 * 3. Copies .mcp.json files
 */
export async function createWorktree(
  originalPath: string,
  branchName: string
): Promise<string> {
  const resolvedOriginal = resolve(originalPath);

  // Calculate worktree path: .rover/{branchName} (gitignored directory)
  const worktreePath = join(resolvedOriginal, '.rover', branchName);

  // 1. Create git worktree with new branch
  await execGit(['worktree', 'add', worktreePath, '-b', branchName], resolvedOriginal);

  // 2. Copy .env* files (except .env.example)
  const envFiles = await findFiles(resolvedOriginal, (name) => name.startsWith('.env'));
  const filteredEnvFiles = envFiles.filter((f) => !f.includes('.env.example'));
  await copyFilesPreservingStructure(filteredEnvFiles, resolvedOriginal, worktreePath);

  // 3. Copy .mcp.json files
  const mcpFiles = await findFiles(resolvedOriginal, (name) => name === '.mcp.json');
  await copyFilesPreservingStructure(mcpFiles, resolvedOriginal, worktreePath);

  return worktreePath;
}

/**
 * Remove a git worktree
 */
export async function removeWorktree(
  originalPath: string,
  worktreePath: string
): Promise<void> {
  const resolvedOriginal = resolve(originalPath);
  await execGit(['worktree', 'remove', worktreePath, '--force'], resolvedOriginal);
}

/**
 * Check if a branch already exists
 */
export async function branchExists(
  repoPath: string,
  branchName: string
): Promise<boolean> {
  try {
    await execGit(['rev-parse', '--verify', branchName], repoPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a unique branch name if the base name already exists
 */
export async function generateUniqueBranchName(
  repoPath: string,
  baseName: string
): Promise<string> {
  if (!(await branchExists(repoPath, baseName))) {
    return baseName;
  }

  // Try appending numbers
  for (let i = 2; i <= 100; i++) {
    const candidateName = `${baseName}-${i}`;
    if (!(await branchExists(repoPath, candidateName))) {
      return candidateName;
    }
  }

  throw new Error(`Could not generate unique branch name for ${baseName}`);
}
