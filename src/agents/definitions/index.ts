import type { AgentDefinition } from '../../types/index.js';

// Original agents
import { criticalPathScout } from './critical-path-scout.js';
import { depthGauge } from './depth-gauge.js';
import { stateDeriver } from './state-deriver.js';
import { generalizer } from './generalizer.js';
import { cohesionAnalyzer } from './cohesion-analyzer.js';
import { obviousnessAuditor } from './obviousness-auditor.js';
import { whyAsker } from './why-asker.js';
import { boilerplateBuster } from './boilerplate-buster.js';
import { consistencyCop } from './consistency-cop.js';

// New rover agents
import { legacyReactPurist } from './legacy-react-purist.js';
import { exceptionAuditor } from './exception-auditor.js';
import { layerPetrifier } from './layer-petrifier.js';
import { namingRenovator } from './naming-renovator.js';
import { securitySweeper } from './security-sweeper.js';
import { logicDetective } from './logic-detective.js';
import { configCleaner } from './config-cleaner.js';
import { interfaceDocumenter } from './interface-documenter.js';

/**
 * Registry of all available scanning agents
 */
export const agents: Record<string, AgentDefinition> = {
  // Code quality & architecture
  'critical-path-scout': criticalPathScout,
  'depth-gauge': depthGauge,
  'generalizer': generalizer,
  'cohesion-analyzer': cohesionAnalyzer,
  'layer-petrifier': layerPetrifier,
  'boilerplate-buster': boilerplateBuster,

  // React specific
  'state-deriver': stateDeriver,
  'legacy-react-purist': legacyReactPurist,

  // Code clarity
  'obviousness-auditor': obviousnessAuditor,
  'why-asker': whyAsker,
  'naming-renovator': namingRenovator,
  'interface-documenter': interfaceDocumenter,

  // Consistency & patterns
  'consistency-cop': consistencyCop,

  // Error handling & bugs
  'exception-auditor': exceptionAuditor,
  'logic-detective': logicDetective,

  // Security & config
  'security-sweeper': securitySweeper,
  'config-cleaner': configCleaner,
};

/**
 * Get all available agent IDs
 */
export function getAgentIds(): string[] {
  return Object.keys(agents);
}

/**
 * Get an agent by ID
 */
export function getAgent(id: string): AgentDefinition | undefined {
  return agents[id];
}

/**
 * Get all agents as an array
 */
export function getAllAgents(): AgentDefinition[] {
  return Object.values(agents);
}

// Export individual agents
export {
  // Code quality & architecture
  criticalPathScout,
  depthGauge,
  generalizer,
  cohesionAnalyzer,
  layerPetrifier,
  boilerplateBuster,

  // React specific
  stateDeriver,
  legacyReactPurist,

  // Code clarity
  obviousnessAuditor,
  whyAsker,
  namingRenovator,
  interfaceDocumenter,

  // Consistency & patterns
  consistencyCop,

  // Error handling & bugs
  exceptionAuditor,
  logicDetective,

  // Security & config
  securitySweeper,
  configCleaner,
};
