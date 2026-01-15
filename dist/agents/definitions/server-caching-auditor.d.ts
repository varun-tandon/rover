import type { AgentDefinition } from '../../types/index.js';
/**
 * The Server Caching Auditor - Server-Side Performance Analyzer
 *
 * Detects server-side performance issues: missing caching strategies,
 * serialization overhead, blocking operations, and data fetching waterfalls.
 *
 * Based on: Vercel React Best Practices server-* rules
 */
export declare const serverCachingAuditor: AgentDefinition;
