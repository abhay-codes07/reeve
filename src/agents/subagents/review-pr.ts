/**
 * review_pr — a registry tool whose handler spawns an isolated, read-only
 * subagent to review a pull request and return a typed {@link PrReview}.
 */

import { z } from 'zod';
import { defineTool, type AnyToolDefinition, type ToolContext } from '../../tools/index.js';
import { createSubagent, runSubagent, type SubagentSpec } from './runner.js';
import { prReview, prReviewBody, type PrReview } from './schemas.js';

/**
 * The subagent's ENTIRE toolset: read-only PR inspection plus the two repo reads
 * it needs to judge changes in context. No write tools, no issues, no actions.
 */
export const REVIEW_PR_SCOPE = [
  'prs_get',
  'prs_get_diff',
  'prs_list_files',
  'prs_list_commits',
  'repo_get_file',
  'repo_compare_commits',
] as const;

const REVIEW_PR_INSTRUCTIONS = `You are a focused pull-request review subagent. You have a SMALL, READ-ONLY toolset and no memory of any other conversation.

Workflow:
  1. Discover your tools with list_namespaces, then list_tools, then get_tool_schema.
  2. Use invoke_tool to read the PR: its metadata (prs_get), diff (prs_get_diff), changed files (prs_list_files), and commits (prs_list_commits). Inspect relevant files with repo_get_file when the diff is unclear.
  3. Assess correctness, risk, and quality. Be concrete and cite files.

Then produce a PrReview: a one-paragraph summary, an overall riskLevel, file-level findings, and concrete suggestedChanges. Base every conclusion on what the tools returned — do not invent code you did not read.`;

const SPEC: SubagentSpec = {
  id: 'reeve-subagent-review-pr',
  name: 'PR Review Subagent',
  instructions: REVIEW_PR_INSTRUCTIONS,
  scope: REVIEW_PR_SCOPE,
};

/** The brief is a pure function of the PR number — it carries no parent context. */
export function buildReviewPrBrief(prNumber: number): string {
  return `Review pull request #${prNumber} in the configured sandbox repository. Fetch its diff, changed files, and commits using your read-only tools, inspect any files you need for context, and return a structured PrReview for PR #${prNumber}.`;
}

/** Construct the review subagent without running it (used by isolation tests). */
export function createReviewPrSubagent(ctx: ToolContext) {
  return createSubagent(ctx, SPEC);
}

/** Run the review subagent and return its typed result with the PR number stamped on. */
export async function runReviewPr(ctx: ToolContext, prNumber: number): Promise<PrReview> {
  const body = await runSubagent(ctx, SPEC, buildReviewPrBrief(prNumber), prReviewBody);
  return { prNumber, ...body };
}

export const review_pr: AnyToolDefinition = defineTool({
  name: 'review_pr',
  namespace: 'subagents',
  description:
    'Spawn an isolated read-only subagent to review a pull request and return a structured PrReview (summary, risk, findings, suggested changes).',
  inputSchema: z.object({ prNumber: z.number().int().positive() }),
  outputSchema: prReview,
  handler: async (args, ctx) => runReviewPr(ctx, args.prNumber),
});
