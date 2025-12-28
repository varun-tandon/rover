import type { AgentDefinition } from '../../types/index.js';
/**
 * The Query Optimizer - Database Query Analyzer
 *
 * Detects N+1 queries, unbounded fetches, missing pagination,
 * inefficient JOINs, and potential missing database indexes.
 */
export declare const queryOptimizer: AgentDefinition;
