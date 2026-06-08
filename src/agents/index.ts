/**
 * Agents public surface + composition.
 *
 * The orchestrator's registry is the base tool registry PLUS the
 * subagent-spawning tools (review_pr, investigate_issue), so the model can
 * discover and delegate to subagents through the same progressive-exposure
 * surface. The base registry stays subagent-free and is the scope source for
 * subagents — keeping the dependency direction one-way (agents -> tools) with no
 * cycles.
 */

import type { Agent } from '@mastra/core/agent';
import { buildRegistry, ToolRegistry } from '../tools/index.js';
import { loadEnv } from '../config/index.js';
import { getGitHubClient } from '../github/index.js';
import { createOrchestrator } from './orchestrator.js';
import { subagentTools } from './subagents/index.js';

/** Build the orchestrator registry: base tools + subagent-spawning tools. */
export function buildOrchestratorRegistry(): ToolRegistry {
  return buildRegistry().registerAll(subagentTools);
}

/**
 * Convenience: build the orchestrator from the validated environment, wiring a
 * real GitHub client and the full (base + subagents) registry. Throws (via
 * loadEnv) if configuration is missing.
 */
export function createDefaultOrchestrator(): Agent {
  const env = loadEnv();
  const github = getGitHubClient(env);
  return createOrchestrator({ github, env }, buildOrchestratorRegistry());
}

export {
  createOrchestrator,
  buildExposureTools,
  ORCHESTRATOR_INSTRUCTIONS,
} from './orchestrator.js';

export {
  subagentTools,
  REVIEW_PR_SCOPE,
  INVESTIGATE_ISSUE_SCOPE,
  buildReviewPrBrief,
  buildInvestigateIssueBrief,
  createReviewPrSubagent,
  createInvestigateIssueSubagent,
  runReviewPr,
  runInvestigateIssue,
  createSubagent,
  runSubagent,
  prReview,
  issueInvestigation,
  type SubagentSpec,
  type SubagentHandle,
  type PrReview,
  type IssueInvestigation,
} from './subagents/index.js';
