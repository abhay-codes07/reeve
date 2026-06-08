/**
 * Long-horizon triage demo (run manually after Gemini quota resets).
 *
 *   pnpm tsx scripts/triage-demo.ts
 *
 * Runs triage_repository against the live GITHUB_SANDBOX_REPO and prints the
 * total tool-call count and the final ranked backlog. This is the ONE clean live
 * run the quota is being conserved for.
 *
 * FAIL-FAST: if a Gemini free-tier rate limit (429 / quota) is hit, the script
 * prints a clear message and exits immediately. It does NOT retry, so it never
 * burns quota in a loop.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Load .env (tsx does not do this automatically).
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
const { triageRepository } = await import('../src/workflows/index.js');

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

  // investigateLimit is the number of Gemini-backed investigations. Keep it
  // modest to fit the free tier; the run still crosses 20+ tool calls via
  // pagination + per-issue context gathering + drafting. Tune without editing:
  //   pnpm tsx scripts/triage-demo.ts 2      (or TRIAGE_INVESTIGATE_LIMIT=2)
  const investigateLimit = Number(
    process.argv[2] ?? process.env.TRIAGE_INVESTIGATE_LIMIT ?? 3,
  );

  hr('TRIAGE START');
  console.log('repo:', `${env.sandbox.owner}/${env.sandbox.repo}`);
  console.log('investigateLimit:', investigateLimit, '(Gemini-backed subagent runs)');
  console.log('Investigations use the live gemini-2.5-flash-lite subagent.');

  const result = await triageRepository({ github, env }, { investigateLimit });

  hr('PLAN (recorded to memory at start)');
  console.log(result.plan.goal);
  result.plan.steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));

  hr('COMPACTED BATCH SUMMARIES (bounded working context)');
  result.batchSummaries.forEach((s) => console.log('  -', s));

  hr('INVESTIGATIONS (subagent, compacted)');
  for (const inv of result.investigations) {
    console.log(`  #${inv.issueNumber} [${inv.severity}/${inv.category}] ${inv.summary}`);
  }

  hr('RANKED BACKLOG');
  for (const item of result.backlog) {
    console.log(
      `  #${item.rank} ${item.category} (${item.priority}) — issues ${item.issueNumbers
        .map((n) => `#${n}`)
        .join(', ')}`,
    );
    console.log(`      labels: ${item.suggestedLabels.join(', ')}`);
    console.log(`      draft : ${item.draftResponse}`);
  }

  hr('SUMMARY');
  console.log('total issues     :', result.totalIssues);
  console.log('clusters         :', result.clusterCount);
  console.log('TOTAL TOOL CALLS :', result.totalToolCalls, result.totalToolCalls > 20 ? '(>20 ✅)' : '(⚠️ under 20)');
}

main().catch((err: unknown) => {
  if (isQuotaError(err)) {
    hr('GEMINI QUOTA EXHAUSTED — STOPPING (no retry)');
    console.error(
      'The Gemini free-tier rate limit (429) was hit. Not retrying, to avoid burning quota.',
    );
    console.error('Please re-run `pnpm tsx scripts/triage-demo.ts` once the quota resets.');
    if (err instanceof Error) console.error('\nupstream:', err.message);
    process.exitCode = 1;
    return;
  }
  hr('ERROR (verbatim)');
  if (err instanceof Error) {
    console.error(err.name + ':', err.message);
    console.error(err.stack);
  } else {
    console.error(err);
  }
  process.exitCode = 1;
});
