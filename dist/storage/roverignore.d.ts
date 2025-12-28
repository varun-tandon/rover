import { type Ignore } from 'ignore';
/**
 * Get the path to the .roverignore file for a target directory.
 */
export declare function getRoverignorePath(targetPath: string): string;
/**
 * Load and parse the .roverignore file.
 * Returns an ignore instance that can filter file paths.
 * If the file doesn't exist, returns an ignore instance with no patterns.
 */
export declare function loadRoverignore(targetPath: string): Promise<Ignore>;
/**
 * Filter an array of file paths, removing those that match .roverignore patterns.
 *
 * @param targetPath - The root directory where .roverignore is located
 * @param files - Array of file paths (relative to targetPath)
 * @returns Filtered array of file paths that don't match any ignore patterns
 */
export declare function filterIgnoredFiles(targetPath: string, files: string[]): Promise<string[]>;
/**
 * Check if a single file path should be ignored.
 *
 * @param targetPath - The root directory where .roverignore is located
 * @param filePath - File path to check (relative to targetPath)
 * @returns true if the file should be ignored
 */
export declare function isFileIgnored(targetPath: string, filePath: string): Promise<boolean>;
/**
 * Filter a git diff string to remove hunks for ignored files.
 *
 * @param targetPath - The root directory where .roverignore is located
 * @param diff - The full git diff string
 * @returns Filtered diff string with ignored files removed
 */
export declare function filterDiffByRoverignore(targetPath: string, diff: string): Promise<string>;
