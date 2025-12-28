import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import ignore from 'ignore';
const ROVERIGNORE_FILE = '.roverignore';
/**
 * Get the path to the .roverignore file for a target directory.
 */
export function getRoverignorePath(targetPath) {
    return join(targetPath, ROVERIGNORE_FILE);
}
/**
 * Load and parse the .roverignore file.
 * Returns an ignore instance that can filter file paths.
 * If the file doesn't exist, returns an ignore instance with no patterns.
 */
export async function loadRoverignore(targetPath) {
    const ignorePath = getRoverignorePath(targetPath);
    const ig = ignore();
    if (!existsSync(ignorePath)) {
        return ig;
    }
    try {
        const content = await readFile(ignorePath, 'utf-8');
        ig.add(content);
        return ig;
    }
    catch {
        // If we can't read the file, return empty ignore
        return ig;
    }
}
/**
 * Filter an array of file paths, removing those that match .roverignore patterns.
 *
 * @param targetPath - The root directory where .roverignore is located
 * @param files - Array of file paths (relative to targetPath)
 * @returns Filtered array of file paths that don't match any ignore patterns
 */
export async function filterIgnoredFiles(targetPath, files) {
    const ig = await loadRoverignore(targetPath);
    return ig.filter(files);
}
/**
 * Check if a single file path should be ignored.
 *
 * @param targetPath - The root directory where .roverignore is located
 * @param filePath - File path to check (relative to targetPath)
 * @returns true if the file should be ignored
 */
export async function isFileIgnored(targetPath, filePath) {
    const ig = await loadRoverignore(targetPath);
    return ig.ignores(filePath);
}
/**
 * Filter a git diff string to remove hunks for ignored files.
 *
 * @param targetPath - The root directory where .roverignore is located
 * @param diff - The full git diff string
 * @returns Filtered diff string with ignored files removed
 */
export async function filterDiffByRoverignore(targetPath, diff) {
    const ig = await loadRoverignore(targetPath);
    // Split diff into file sections
    // Each file section starts with "diff --git a/path b/path"
    const sections = diff.split(/(?=^diff --git )/m);
    const filteredSections = sections.filter(section => {
        if (!section.trim())
            return false;
        // Extract the file path from the diff header
        // Format: "diff --git a/path/to/file b/path/to/file"
        const match = section.match(/^diff --git a\/(.+?) b\/(.+?)$/m);
        if (!match?.[2])
            return true; // Keep sections we can't parse
        const filePath = match[2]; // Use the "b" path (destination)
        return !ig.ignores(filePath);
    });
    return filteredSections.join('');
}
