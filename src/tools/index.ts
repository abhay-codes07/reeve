/**
 * Tool registry assembly + public surface.
 *
 * Builds the single {@link ToolRegistry} from every namespace module and exports
 * the progressive-exposure operations. Step 4 will wrap these four operations as
 * the only tools handed to the orchestrator agent, so the model discovers and
 * selects from 50+ tools by name without holding all definitions in context.
 */

import { ToolRegistry } from './registry.js';
import { issueTools } from './namespaces/issues.js';
import { prTools } from './namespaces/prs.js';
import { repoTools } from './namespaces/repo.js';
import { actionTools } from './namespaces/actions.js';
import { searchTools } from './namespaces/search.js';
import { checkTools } from './namespaces/checks.js';
import { releaseTools } from './namespaces/releases.js';
import { triageTools } from './namespaces/triage.js';

/** Build a fresh registry populated with all tools. */
export function buildRegistry(): ToolRegistry {
  return new ToolRegistry().registerAll([
    ...issueTools,
    ...prTools,
    ...repoTools,
    ...actionTools,
    ...searchTools,
    ...checkTools,
    ...releaseTools,
    ...triageTools,
  ]);
}

/** The process-wide registry (single source of truth). */
export const registry: ToolRegistry = buildRegistry();

export { ToolRegistry } from './registry.js';
export {
  listNamespaces,
  listTools,
  getToolSchema,
  invokeTool,
  type NamespaceInfo,
  type ToolListing,
  type ToolSchema,
} from './exposure.js';
export {
  defineTool,
  NAMESPACES,
  type Namespace,
  type ToolContext,
  type ToolDefinition,
  type AnyToolDefinition,
} from './types.js';
