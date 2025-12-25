import { readFile, appendFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ensureRoverDir, getRoverDir } from './issues.js';

const MEMORY_FILE = 'memory.md';

/**
 * Get the path to the memory file for a target directory.
 */
export function getMemoryPath(targetPath: string): string {
  return join(getRoverDir(targetPath), MEMORY_FILE);
}

/**
 * Load the memory file contents.
 * Returns empty string if file doesn't exist.
 */
export async function loadMemory(targetPath: string): Promise<string> {
  const memoryPath = getMemoryPath(targetPath);

  if (!existsSync(memoryPath)) {
    return '';
  }

  try {
    return await readFile(memoryPath, 'utf-8');
  } catch (error) {
    // Propagate filesystem errors for debugging
    throw error;
  }
}

/**
 * Append a new entry to the memory file.
 * Creates the file with a header if it doesn't exist.
 */
export async function appendMemory(targetPath: string, entry: string): Promise<void> {
  await ensureRoverDir(targetPath);
  const memoryPath = getMemoryPath(targetPath);

  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const formattedEntry = `\n---\n\n## ${timestamp}\n${entry}\n`;

  if (!existsSync(memoryPath)) {
    // Create new file with header
    const header = `# Rover Memory

Issues and patterns listed here will be ignored by all agents.
`;
    await writeFile(memoryPath, header + formattedEntry, 'utf-8');
  } else {
    // Append to existing file
    await appendFile(memoryPath, formattedEntry, 'utf-8');
  }
}
