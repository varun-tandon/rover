/**
 * Throttles function calls using leading-edge execution with trailing-edge guarantee.
 *
 * Behavior:
 * - First call executes immediately (leading edge)
 * - Subsequent calls within the delay period are queued
 * - After delay elapses, the most recent queued call executes (trailing edge)
 * - This ensures both immediate response and that the final state is always applied
 *
 * @param fn - The function to throttle
 * @param delay - Minimum time between executions in milliseconds.
 *   Chosen based on use case:
 *   - 150-200ms: UI updates where responsiveness matters (scan progress)
 *   - 300ms: Less critical updates that happen frequently (voter progress)
 * @returns A throttled version of the function with the same signature
 *
 * @example
 * const throttledUpdate = throttle((msg: string) => setMessage(msg), 200);
 * throttledUpdate('first');  // Executes immediately
 * throttledUpdate('second'); // Queued
 * throttledUpdate('third');  // Replaces 'second' in queue
 * // After 200ms, 'third' executes
 */
export declare function throttle<T extends (...args: Parameters<T>) => void>(fn: T, delay: number): T;
