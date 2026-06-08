/**
 * Eval runner — `pnpm eval`.
 *
 * Executes the scored scenarios and prints a per-scenario pass/fail report with a
 * total score.
 *
 * Judge mode (default behaviour):
 *   - DEFAULT: live LLM judge on google/gemini-2.5-flash-lite (hits Gemini).
 *   - `pnpm eval --mock`  (or EVAL_MOCK=1): fully offline, stubbed judge — no
 *     network, no model. Deterministic checks still run for real.
 *
 * Live runs FAIL FAST on a Gemini rate limit (429): a clear message is printed
 * and the process exits without retrying, so quota is never burned in a loop.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Load .env (tsx does not do this automatically); only needed for the live judge.
try {
  const text = readFileSync(resolve(process.cwd(), '.env'), 'utf-8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[1] && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {
  /* offline / mock mode needs no env */
}

const { runEval, formatReport, createLlmJudge, mockJudge, isQuotaError, SCENARIOS } = await import(
  '../src/eval/index.js'
);

const mock = process.argv.includes('--mock') || process.env.EVAL_MOCK === '1';

async function main(): Promise<void> {
  const judge = mock ? mockJudge : createLlmJudge();
  console.log(`Reeve eval — ${SCENARIOS.length} scenarios — judge: ${mock ? 'MOCK (offline)' : 'LIVE gemini-2.5-flash-lite'}\n`);

  const report = await runEval(SCENARIOS, judge);
  console.log(formatReport(report));

  // Non-zero exit if any scenario failed, so CI/automation can gate on it.
  if (report.passed < report.total) process.exitCode = 1;
}

main().catch((err: unknown) => {
  if (isQuotaError(err)) {
    console.error('\n=== GEMINI QUOTA EXHAUSTED — STOPPING (no retry) ===');
    console.error('The live judge hit a Gemini rate limit (429). Not retrying.');
    console.error('Re-run `pnpm eval` once the quota resets, or use `pnpm eval --mock` to run offline.');
    if (err instanceof Error) console.error('\nupstream:', err.message);
    process.exitCode = 1;
    return;
  }
  console.error('\nEval failed:', err instanceof Error ? err.stack : err);
  process.exitCode = 1;
});
