/**
 * The composable triage chain — Reeve's reference example of invariant #5
 * (tools that consume each other's structured output).
 *
 *   search_issues ──issueSet──▶ cluster_issues ──clusterSet──▶ draft_triage_report ──triageReport──▶
 *
 * The handoff is enforced at the type AND value level: each step's
 * `outputSchema` is *the same zod object* as the next step's `inputSchema`
 * (shared by reference), so it is impossible for the shapes to drift. See
 * {@link assertChainSchemasAlign}, which the unit test exercises.
 *
 * `runTriageChain` pipes a real run: it pulls issues via `search_issues` (a real
 * GitHub call through the Step-2 client), then applies the two deterministic
 * transforms. Every hop goes through `invokeTool`, so each boundary is
 * schema-validated and errors are mapped into the taxonomy.
 */

import type { ToolContext, AnyToolDefinition } from '../tools/index.js';
import { registry, invokeTool } from '../tools/index.js';
import { triageReport, type TriageReport } from '../tools/namespaces/triage.js';

/** The three chain steps, in order, resolved from the single registry. */
export const TRIAGE_CHAIN_STEPS = ['search_issues', 'cluster_issues', 'draft_triage_report'] as const;

/** The ordered tool definitions for the chain. */
export function triageChainTools(): AnyToolDefinition[] {
  return TRIAGE_CHAIN_STEPS.map((name) => registry.get(name));
}

/**
 * Verify the chain's handoffs line up: each step's output schema is exactly the
 * next step's input schema. Returns the per-hop result; throws on a mismatch.
 * Used by the unit test and safe to call at startup as a sanity check.
 */
export function assertChainSchemasAlign(): Array<{ from: string; to: string; aligned: boolean }> {
  const steps = triageChainTools();
  const results: Array<{ from: string; to: string; aligned: boolean }> = [];
  for (let i = 0; i < steps.length - 1; i++) {
    const from = steps[i]!;
    const to = steps[i + 1]!;
    const aligned = from.outputSchema === to.inputSchema;
    results.push({ from: from.name, to: to.name, aligned });
    if (!aligned) {
      throw new Error(
        `Triage chain handoff broken: ${from.name}.outputSchema is not ${to.name}.inputSchema`,
      );
    }
  }
  return results;
}

export interface TriageChainArgs {
  /** Search query for step 1; auto-narrowed to issues by the tool. */
  query?: string;
  /** Max issues to pull (per_page). */
  limit?: number;
}

/**
 * Run the full chain end to end against the configured GitHub context and return
 * the validated triage report. Each step consumes the previous step's output.
 */
export async function runTriageChain(
  ctx: ToolContext,
  args: TriageChainArgs = {},
): Promise<TriageReport> {
  const query = args.query ?? `repo:${ctx.env.sandbox.owner}/${ctx.env.sandbox.repo} is:open`;
  const perPage = args.limit ?? 50;

  // Step 1: search_issues -> issueSet (real GitHub call).
  const issueSetResult = await invokeTool(registry, 'search_issues', { query, perPage }, ctx);

  // Step 2: cluster_issues consumes the issueSet -> clusterSet.
  const clusterSetResult = await invokeTool(registry, 'cluster_issues', issueSetResult, ctx);

  // Step 3: draft_triage_report consumes the clusterSet -> triageReport.
  const reportResult = await invokeTool(registry, 'draft_triage_report', clusterSetResult, ctx);

  // Final defensive parse against the public report schema.
  return triageReport.parse(reportResult);
}
