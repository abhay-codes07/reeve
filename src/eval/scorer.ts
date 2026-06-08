/**
 * The two-mode scorer.
 *
 *  - DETERMINISTIC checks assert on structured outcomes (exact / contains /
 *    ordering). No model involved — these are the backbone of the eval.
 *  - JUDGE checks delegate a fuzzy criterion to a {@link Judge}. The judge is
 *    injected, so the same scenarios run live or fully offline (mock judge).
 *
 * A scenario passes only if all its checks pass; its score is the mean check
 * score. The eval's total score is the mean scenario score.
 */

import type { Judge } from './judge.js';

export interface DeterministicCheck {
  kind: 'deterministic';
  description: string;
  /** Inspect the produced outcome and return pass + a human-readable detail. */
  run: (actual: unknown) => { pass: boolean; detail: string };
}

export interface JudgeCheck {
  kind: 'judge';
  description: string;
  /** The fuzzy criterion handed to the judge. */
  criterion: string;
  /** Extract the text the judge should evaluate from the outcome. */
  content: (actual: unknown) => string;
}

export type Check = DeterministicCheck | JudgeCheck;

export interface Scenario {
  id: string;
  description: string;
  /** Produce the actual outcome to score. Offline for all built-in scenarios. */
  produce: () => Promise<unknown> | unknown;
  checks: Check[];
}

export interface CheckResult {
  description: string;
  kind: Check['kind'];
  pass: boolean;
  score: number;
  detail: string;
}

export interface ScenarioResult {
  id: string;
  description: string;
  pass: boolean;
  score: number;
  checks: CheckResult[];
}

export interface EvalReport {
  scenarios: ScenarioResult[];
  totalScore: number;
  passed: number;
  total: number;
}

async function runCheck(check: Check, actual: unknown, judge: Judge): Promise<CheckResult> {
  if (check.kind === 'deterministic') {
    const { pass, detail } = check.run(actual);
    return { description: check.description, kind: 'deterministic', pass, score: pass ? 1 : 0, detail };
  }
  const verdict = await judge(check.criterion, check.content(actual));
  return {
    description: check.description,
    kind: 'judge',
    pass: verdict.pass,
    score: verdict.score,
    detail: verdict.reason,
  };
}

export async function scoreScenario(scenario: Scenario, judge: Judge): Promise<ScenarioResult> {
  const actual = await scenario.produce();
  const checks: CheckResult[] = [];
  for (const check of scenario.checks) {
    checks.push(await runCheck(check, actual, judge));
  }
  const pass = checks.every((c) => c.pass);
  const score = checks.length ? checks.reduce((s, c) => s + c.score, 0) / checks.length : 0;
  return { id: scenario.id, description: scenario.description, pass, score, checks };
}

export async function runEval(scenarios: Scenario[], judge: Judge): Promise<EvalReport> {
  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    results.push(await scoreScenario(scenario, judge));
  }
  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const totalScore = total ? results.reduce((s, r) => s + r.score, 0) / total : 0;
  return { scenarios: results, totalScore, passed, total };
}

/** Render an {@link EvalReport} as a human-readable per-scenario report. */
export function formatReport(report: EvalReport): string {
  const lines: string[] = [];
  for (const s of report.scenarios) {
    lines.push(`${s.pass ? 'PASS' : 'FAIL'}  [${s.score.toFixed(2)}]  ${s.id} — ${s.description}`);
    for (const c of s.checks) {
      const tag = c.kind === 'judge' ? 'judge' : 'exact';
      lines.push(`        ${c.pass ? '✓' : '✗'} (${tag}) ${c.description} — ${c.detail}`);
    }
  }
  lines.push('');
  lines.push(
    `TOTAL: ${report.passed}/${report.total} scenarios passed · mean score ${report.totalScore.toFixed(2)}`,
  );
  return lines.join('\n');
}
