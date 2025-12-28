/**
 * Get the path to the memory file for a target directory.
 */
export declare function getMemoryPath(targetPath: string): string;
/**
 * Load the memory file contents.
 * Returns empty string if file doesn't exist.
 */
export declare function loadMemory(targetPath: string): Promise<string>;
/**
 * Append a new entry to the memory file.
 * Creates the file with a header if it doesn't exist.
 */
export declare function appendMemory(targetPath: string, entry: string): Promise<void>;
