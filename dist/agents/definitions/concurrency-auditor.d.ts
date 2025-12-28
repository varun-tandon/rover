import type { AgentDefinition } from '../../types/index.js';
/**
 * The Concurrency Auditor - Race Condition & Timing Bug Detector
 *
 * Identifies race conditions, stale closures, missing cancellation,
 * and timing-related bugs that cause hard-to-reproduce issues.
 */
export declare const concurrencyAuditor: AgentDefinition;
