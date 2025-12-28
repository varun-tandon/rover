// Architecture agents
import { depthGauge } from './depth-gauge.js';
import { generalizer } from './generalizer.js';
import { cohesionAnalyzer } from './cohesion-analyzer.js';
import { layerPetrifier } from './layer-petrifier.js';
import { boilerplateBuster } from './boilerplate-buster.js';
// Code clarity agents
import { obviousnessAuditor } from './obviousness-auditor.js';
import { whyAsker } from './why-asker.js';
import { namingRenovator } from './naming-renovator.js';
import { commentNoiseDetector } from './comment-noise-detector.js';
// Consistency agents
import { consistencyCop } from './consistency-cop.js';
// Bug detection agents
import { exceptionAuditor } from './exception-auditor.js';
import { logicDetective } from './logic-detective.js';
import { concurrencyAuditor } from './concurrency-auditor.js';
// Accessibility agents
import { accessibilityAuditor } from './accessibility-auditor.js';
// State architecture agents
import { stateArchitectureAuditor } from './state-architecture-auditor.js';
// Config agents
import { configCleaner } from './config-cleaner.js';
// Performance agents
import { queryOptimizer } from './query-optimizer.js';
import { asyncEfficiencyAuditor } from './async-efficiency-auditor.js';
// Dependency agents
import { dependencyAuditor } from './dependency-auditor.js';
// Code health agents
import { deadCodeDetector } from './dead-code-detector.js';
import { complexityAnalyzer } from './complexity-analyzer.js';
import { duplicationFinder } from './duplication-finder.js';
import { staleArtifactDetector } from './stale-artifact-detector.js';
// API agents
import { apiContractValidator } from './api-contract-validator.js';
// Next.js agents
import { clientBoundaryOptimizer } from './client-boundary-optimizer.js';
import { serverActionAuditor } from './server-action-auditor.js';
import { dataFetchingStrategist } from './data-fetching-strategist.js';
import { routeSegmentAnalyzer } from './route-segment-analyzer.js';
import { nextjsAssetOptimizer } from './nextjs-asset-optimizer.js';
import { hydrationMismatchDetector } from './hydration-mismatch-detector.js';
import { navigationPatternEnforcer } from './navigation-pattern-enforcer.js';
import { metadataChecker } from './metadata-checker.js';
import { designSystemEnforcer } from './design-system-enforcer.js';
// Consolidated agents
import { reactPatternsAuditor } from './react-patterns-auditor.js';
import { nextjsRenderingOptimizer } from './nextjs-rendering-optimizer.js';
import { bundlePerformanceAuditor } from './bundle-performance-auditor.js';
import { securityAuditor } from './security-auditor.js';
import { typescriptQualityAuditor } from './typescript-quality-auditor.js';
// Consistency and migration agents
import { apiRouteConsistencyAuditor } from './api-route-consistency-auditor.js';
import { partialMigrationDetector } from './partial-migration-detector.js';
import { stateDuplicationAuditor } from './state-duplication-auditor.js';
import { dataFetchingConsistencyAuditor } from './data-fetching-consistency-auditor.js';
import { asyncFireAndForgetDetector } from './async-fire-and-forget-detector.js';
/**
 * Registry of all available scanning agents
 */
export const agents = {
    // Architecture
    'depth-gauge': depthGauge,
    'generalizer': generalizer,
    'cohesion-analyzer': cohesionAnalyzer,
    'layer-petrifier': layerPetrifier,
    'boilerplate-buster': boilerplateBuster,
    // Code clarity
    'obviousness-auditor': obviousnessAuditor,
    'why-asker': whyAsker,
    'naming-renovator': namingRenovator,
    'comment-noise-detector': commentNoiseDetector,
    // Consistency
    'consistency-cop': consistencyCop,
    // Bug detection
    'exception-auditor': exceptionAuditor,
    'logic-detective': logicDetective,
    'concurrency-auditor': concurrencyAuditor,
    // Accessibility
    'accessibility-auditor': accessibilityAuditor,
    // State architecture
    'state-architecture-auditor': stateArchitectureAuditor,
    // Config
    'config-cleaner': configCleaner,
    // Performance
    'query-optimizer': queryOptimizer,
    'async-efficiency-auditor': asyncEfficiencyAuditor,
    // Dependencies
    'dependency-auditor': dependencyAuditor,
    // Code health
    'dead-code-detector': deadCodeDetector,
    'complexity-analyzer': complexityAnalyzer,
    'duplication-finder': duplicationFinder,
    'stale-artifact-detector': staleArtifactDetector,
    // API
    'api-contract-validator': apiContractValidator,
    // Next.js
    'client-boundary-optimizer': clientBoundaryOptimizer,
    'server-action-auditor': serverActionAuditor,
    'data-fetching-strategist': dataFetchingStrategist,
    'route-segment-analyzer': routeSegmentAnalyzer,
    'nextjs-asset-optimizer': nextjsAssetOptimizer,
    'hydration-mismatch-detector': hydrationMismatchDetector,
    'navigation-pattern-enforcer': navigationPatternEnforcer,
    'metadata-checker': metadataChecker,
    'design-system-enforcer': designSystemEnforcer,
    // Consolidated agents
    'react-patterns-auditor': reactPatternsAuditor,
    'nextjs-rendering-optimizer': nextjsRenderingOptimizer,
    'bundle-performance-auditor': bundlePerformanceAuditor,
    'security-auditor': securityAuditor,
    'typescript-quality-auditor': typescriptQualityAuditor,
    // Consistency and migration agents
    'api-route-consistency-auditor': apiRouteConsistencyAuditor,
    'partial-migration-detector': partialMigrationDetector,
    'state-duplication-auditor': stateDuplicationAuditor,
    'data-fetching-consistency-auditor': dataFetchingConsistencyAuditor,
    'async-fire-and-forget-detector': asyncFireAndForgetDetector,
};
/**
 * Get all available agent IDs
 */
export function getAgentIds() {
    return Object.keys(agents);
}
/**
 * Get an agent by ID
 */
export function getAgent(id) {
    return agents[id];
}
/**
 * Get all agents as an array
 */
export function getAllAgents() {
    return Object.values(agents);
}
// Export individual agents
export { 
// Architecture
depthGauge, generalizer, cohesionAnalyzer, layerPetrifier, boilerplateBuster, 
// Code clarity
obviousnessAuditor, whyAsker, namingRenovator, commentNoiseDetector, 
// Consistency
consistencyCop, 
// Bug detection
exceptionAuditor, logicDetective, concurrencyAuditor, 
// Accessibility
accessibilityAuditor, 
// State architecture
stateArchitectureAuditor, 
// Config
configCleaner, 
// Performance
queryOptimizer, asyncEfficiencyAuditor, 
// Dependencies
dependencyAuditor, 
// Code health
deadCodeDetector, complexityAnalyzer, duplicationFinder, staleArtifactDetector, 
// API
apiContractValidator, 
// Next.js
clientBoundaryOptimizer, serverActionAuditor, dataFetchingStrategist, routeSegmentAnalyzer, nextjsAssetOptimizer, hydrationMismatchDetector, navigationPatternEnforcer, metadataChecker, designSystemEnforcer, 
// Consolidated agents
reactPatternsAuditor, nextjsRenderingOptimizer, bundlePerformanceAuditor, securityAuditor, typescriptQualityAuditor, 
// Consistency and migration agents
apiRouteConsistencyAuditor, partialMigrationDetector, stateDuplicationAuditor, dataFetchingConsistencyAuditor, asyncFireAndForgetDetector, };
