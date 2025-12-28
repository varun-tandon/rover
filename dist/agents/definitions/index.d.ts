import type { AgentDefinition } from '../../types/index.js';
import { depthGauge } from './depth-gauge.js';
import { generalizer } from './generalizer.js';
import { cohesionAnalyzer } from './cohesion-analyzer.js';
import { layerPetrifier } from './layer-petrifier.js';
import { boilerplateBuster } from './boilerplate-buster.js';
import { obviousnessAuditor } from './obviousness-auditor.js';
import { whyAsker } from './why-asker.js';
import { namingRenovator } from './naming-renovator.js';
import { commentNoiseDetector } from './comment-noise-detector.js';
import { consistencyCop } from './consistency-cop.js';
import { exceptionAuditor } from './exception-auditor.js';
import { logicDetective } from './logic-detective.js';
import { concurrencyAuditor } from './concurrency-auditor.js';
import { accessibilityAuditor } from './accessibility-auditor.js';
import { stateArchitectureAuditor } from './state-architecture-auditor.js';
import { configCleaner } from './config-cleaner.js';
import { queryOptimizer } from './query-optimizer.js';
import { asyncEfficiencyAuditor } from './async-efficiency-auditor.js';
import { dependencyAuditor } from './dependency-auditor.js';
import { deadCodeDetector } from './dead-code-detector.js';
import { complexityAnalyzer } from './complexity-analyzer.js';
import { duplicationFinder } from './duplication-finder.js';
import { staleArtifactDetector } from './stale-artifact-detector.js';
import { apiContractValidator } from './api-contract-validator.js';
import { clientBoundaryOptimizer } from './client-boundary-optimizer.js';
import { serverActionAuditor } from './server-action-auditor.js';
import { dataFetchingStrategist } from './data-fetching-strategist.js';
import { routeSegmentAnalyzer } from './route-segment-analyzer.js';
import { nextjsAssetOptimizer } from './nextjs-asset-optimizer.js';
import { hydrationMismatchDetector } from './hydration-mismatch-detector.js';
import { navigationPatternEnforcer } from './navigation-pattern-enforcer.js';
import { metadataChecker } from './metadata-checker.js';
import { designSystemEnforcer } from './design-system-enforcer.js';
import { reactPatternsAuditor } from './react-patterns-auditor.js';
import { nextjsRenderingOptimizer } from './nextjs-rendering-optimizer.js';
import { bundlePerformanceAuditor } from './bundle-performance-auditor.js';
import { securityAuditor } from './security-auditor.js';
import { typescriptQualityAuditor } from './typescript-quality-auditor.js';
import { apiRouteConsistencyAuditor } from './api-route-consistency-auditor.js';
import { partialMigrationDetector } from './partial-migration-detector.js';
import { stateDuplicationAuditor } from './state-duplication-auditor.js';
import { dataFetchingConsistencyAuditor } from './data-fetching-consistency-auditor.js';
import { asyncFireAndForgetDetector } from './async-fire-and-forget-detector.js';
/**
 * Registry of all available scanning agents
 */
export declare const agents: Record<string, AgentDefinition>;
/**
 * Get all available agent IDs
 */
export declare function getAgentIds(): string[];
/**
 * Get an agent by ID
 */
export declare function getAgent(id: string): AgentDefinition | undefined;
/**
 * Get all agents as an array
 */
export declare function getAllAgents(): AgentDefinition[];
export { depthGauge, generalizer, cohesionAnalyzer, layerPetrifier, boilerplateBuster, obviousnessAuditor, whyAsker, namingRenovator, commentNoiseDetector, consistencyCop, exceptionAuditor, logicDetective, concurrencyAuditor, accessibilityAuditor, stateArchitectureAuditor, configCleaner, queryOptimizer, asyncEfficiencyAuditor, dependencyAuditor, deadCodeDetector, complexityAnalyzer, duplicationFinder, staleArtifactDetector, apiContractValidator, clientBoundaryOptimizer, serverActionAuditor, dataFetchingStrategist, routeSegmentAnalyzer, nextjsAssetOptimizer, hydrationMismatchDetector, navigationPatternEnforcer, metadataChecker, designSystemEnforcer, reactPatternsAuditor, nextjsRenderingOptimizer, bundlePerformanceAuditor, securityAuditor, typescriptQualityAuditor, apiRouteConsistencyAuditor, partialMigrationDetector, stateDuplicationAuditor, dataFetchingConsistencyAuditor, asyncFireAndForgetDetector, };
