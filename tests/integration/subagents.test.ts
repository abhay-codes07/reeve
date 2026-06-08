/**
 * Integration tests for the isolated subagents against the live sandbox repo and
 * the worker model (google/gemini-2.5-flash-lite). They exercise the full path:
 * a subagent discovers its scoped tools, reads from GitHub, and returns a typed
 * structured result. Self-skips when credentials are absent.
 *
 *  - review_pr runs on the FIRST open PR, or self-skips if the repo has none yet
 *    (the user adds PRs manually).
 *  - investigate_issue runs on a seeded open issue.
 */

import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/index.js';
import { GitHubClient } from '../../src/github/index.js';
import type { ToolContext } from '../../src/tools/index.js';
import {
  runReviewPr,
  runInvestigateIssue,
  prReview,
  issueInvestigation,
} from '../../src/agents/index.js';

const configured = Boolean(
  process.env.GITHUB_TOKEN &&
    process.env.GOOGLE_GENERATIVE_AI_API_KEY &&
    process.env.GITHUB_SANDBOX_REPO,
);

function realContext(): ToolContext {
  const env = loadEnv(process.env, { reload: true });
  const github = new GitHubClient({ auth: env.GITHUB_TOKEN }, env);
  return { github, env };
}

/** Free-tier Gemini allows ~20 req/min; a multi-step subagent can exhaust it. */
function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return msg.includes('quota') || msg.includes('rate limit') || msg.includes('429');
}

describe.skipIf(!configured)('subagents (integration, live model + sandbox)', () => {
  it(
    'review_pr returns a valid PrReview for the first open PR (skips if none)',
    async (t) => {
      const ctx = realContext();
      const { owner, repo } = ctx.env.sandbox;
      const { data: pulls } = await ctx.github.request('github.pulls.list', (o) =>
        o.rest.pulls.list({ owner, repo, state: 'open', per_page: 1 }),
      );
      if (pulls.length === 0) {
        t.skip(); // no PRs in the sandbox yet
        return;
      }
      const prNumber = pulls[0]!.number;
      let review;
      try {
        review = await runReviewPr(ctx, prNumber);
      } catch (err) {
        if (isQuotaError(err)) return t.skip(); // free-tier rate limit, not a defect
        throw err;
      }

      expect(prReview.safeParse(review).success).toBe(true);
      expect(review.prNumber).toBe(prNumber);
      expect(review.summary.length).toBeGreaterThan(0);
      expect(['low', 'medium', 'high', 'critical']).toContain(review.riskLevel);
      expect(Array.isArray(review.findings)).toBe(true);
    },
    90_000,
  );

  it(
    'investigate_issue returns a valid IssueInvestigation for a seeded issue',
    async (t) => {
      const ctx = realContext();
      const { owner, repo } = ctx.env.sandbox;
      const { data: issues } = await ctx.github.request('github.issues.listForRepo', (o) =>
        o.rest.issues.listForRepo({ owner, repo, state: 'open', per_page: 20 }),
      );
      const issue = issues.find((i) => !i.pull_request);
      if (!issue) {
        t.skip(); // no issues seeded
        return;
      }
      let investigation;
      try {
        investigation = await runInvestigateIssue(ctx, issue.number);
      } catch (err) {
        if (isQuotaError(err)) return t.skip(); // free-tier rate limit, not a defect
        throw err;
      }

      expect(issueInvestigation.safeParse(investigation).success).toBe(true);
      expect(investigation.issueNumber).toBe(issue.number);
      expect(investigation.summary.length).toBeGreaterThan(0);
      expect(Array.isArray(investigation.likelyCauses)).toBe(true);
      expect(typeof investigation.needsMoreInfo).toBe('boolean');
    },
    90_000,
  );
});
