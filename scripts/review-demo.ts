/**
 * review_pr live demo — runs the isolated PR-review subagent on the first open
 * PR in the sandbox and prints the typed PrReview.
 *
 *   pnpm tsx scripts/review-demo.ts
 *
 * Skips gracefully if there is no open PR. Fails fast on a Gemini 429 (no retry).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

try {
  const text = readFileSync(resolve(process.cwd(), '.env'), 'utf-8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[1] && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {
  /* rely on ambient env */
}

const { loadEnv } = await import('../src/config/index.js');
const { getGitHubClient } = await import('../src/github/index.js');
const { runReviewPr } = await import('../src/agents/index.js');

function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return msg.includes('quota') || msg.includes('rate limit') || msg.includes('429');
}

function hr(label: string): void {
  console.log(`\n${'='.repeat(8)} ${label} ${'='.repeat(8)}`);
}

async function main(): Promise<void> {
  const env = loadEnv();
  const github = getGitHubClient(env);
  const { owner, repo } = env.sandbox;

  const { data: pulls } = await github.request('github.pulls.list', (o) =>
    o.rest.pulls.list({ owner, repo, state: 'open', per_page: 1 }),
  );
  if (pulls.length === 0) {
    console.log('skipped (no PR)');
    return;
  }
  const prNumber = pulls[0]!.number;
  hr('REVIEW TARGET');
  console.log(`PR #${prNumber}: ${pulls[0]!.title}`);
  console.log('Reviewing with the isolated read-only subagent (gemini-2.5-flash-lite).');

  const review = await runReviewPr({ github, env }, prNumber);

  hr('PR REVIEW (typed result)');
  console.log('prNumber  :', review.prNumber);
  console.log('riskLevel :', review.riskLevel);
  console.log('summary   :', review.summary);
  hr('FINDINGS');
  for (const f of review.findings) {
    console.log(`  [${f.severity}] ${f.file}: ${f.finding}`);
  }
  hr('SUGGESTED CHANGES');
  for (const s of review.suggestedChanges) console.log('  -', s);
}

main().catch((err: unknown) => {
  if (isQuotaError(err)) {
    hr('GEMINI QUOTA EXHAUSTED — STOPPING (no retry)');
    console.error('Hit a Gemini rate limit (429). Re-run once quota resets.');
    if (err instanceof Error) console.error('upstream:', err.message);
    process.exitCode = 1;
    return;
  }
  hr('ERROR (verbatim)');
  console.error(err instanceof Error ? err.stack : err);
  process.exitCode = 1;
});
