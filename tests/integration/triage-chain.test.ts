/**
 * End-to-end integration test for the composable triage chain.
 *
 * Runs search_issues -> cluster_issues -> draft_triage_report against the real
 * GITHUB_SANDBOX_REPO and validates the final report shape. Step 1 is a real
 * GitHub call; steps 2-3 are deterministic transforms. The assertions are about
 * SHAPE, not content, so the test is stable regardless of how many issues the
 * sandbox repo currently has (including zero).
 *
 * Self-skips when credentials are not configured, so `pnpm test` stays green in
 * environments without a token.
 */

import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/index.js';
import { GitHubClient } from '../../src/github/index.js';
import type { ToolContext } from '../../src/tools/index.js';
import { runTriageChain, assertChainSchemasAlign } from '../../src/workflows/index.js';
import { triageReport } from '../../src/tools/namespaces/triage.js';

const configured = Boolean(process.env.GITHUB_TOKEN && process.env.GITHUB_SANDBOX_REPO);

describe.skipIf(!configured)('triage chain (integration, real sandbox repo)', () => {
  function realContext(): ToolContext {
    const env = loadEnv(process.env, { reload: true });
    const github = new GitHubClient({ auth: env.GITHUB_TOKEN }, env);
    return { github, env };
  }

  it('schemas align before running', () => {
    expect(assertChainSchemasAlign().every((h) => h.aligned)).toBe(true);
  });

  it('runs end-to-end and returns a valid ranked triage report', async () => {
    const ctx = realContext();
    const report = await runTriageChain(ctx, { limit: 30 });

    // Conforms to the published report schema.
    expect(triageReport.safeParse(report).success).toBe(true);

    // Structural invariants.
    expect(typeof report.summary).toBe('string');
    expect(report.summary.length).toBeGreaterThan(0);
    expect(report.generatedFrom.issueCount).toBeGreaterThanOrEqual(0);
    expect(report.generatedFrom.clusterCount).toBe(report.backlog.length);

    // Backlog is ranked 1..n by descending priority order.
    report.backlog.forEach((item, idx) => {
      expect(item.rank).toBe(idx + 1);
      expect(item.issueNumbers).toBeInstanceOf(Array);
      expect(item.suggestedLabels.length).toBeGreaterThan(0);
      expect(item.draftResponse.length).toBeGreaterThan(0);
    });
  }, 30_000);
});
