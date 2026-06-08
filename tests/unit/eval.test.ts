/**
 * Eval harness unit tests (network-hermetic, NO live model). The judge is always
 * a stub/injected function, so no Gemini call is made.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  runEval,
  scoreScenario,
  mockJudge,
  SCENARIOS,
  type Scenario,
  type Judge,
} from '../../src/eval/index.js';

describe('eval scorer', () => {
  it('deterministic checks drive pass/fail and score', async () => {
    const scenario: Scenario = {
      id: 's1',
      description: 'mixed checks',
      produce: () => ({ value: 42 }),
      checks: [
        {
          kind: 'deterministic',
          description: 'value is 42',
          run: (a) => ({ pass: (a as any).value === 42, detail: 'ok' }),
        },
        {
          kind: 'deterministic',
          description: 'value is 0 (fails)',
          run: (a) => ({ pass: (a as any).value === 0, detail: 'nope' }),
        },
      ],
    };
    const result = await scoreScenario(scenario, mockJudge);
    expect(result.pass).toBe(false); // one check failed
    expect(result.score).toBe(0.5); // 1 of 2
  });

  it('judge checks delegate to the injected judge (the only model seam)', async () => {
    const judge: Judge = vi.fn(async (criterion, content) => ({
      pass: content.includes('redact'),
      score: content.includes('redact') ? 1 : 0,
      reason: 'checked for redact',
    }));
    const scenario: Scenario = {
      id: 's2',
      description: 'judge check',
      produce: () => 'we should redact tokens',
      checks: [
        {
          kind: 'judge',
          description: 'mentions redaction',
          criterion: 'Does it mention redaction?',
          content: (a) => a as string,
        },
      ],
    };
    const result = await scoreScenario(scenario, judge);
    expect(judge).toHaveBeenCalledOnce();
    expect(result.pass).toBe(true);
    expect(result.score).toBe(1);
  });

  it('mockJudge is offline and passes on non-empty content', async () => {
    await expect(mockJudge('any', 'something')).resolves.toMatchObject({ pass: true, score: 1 });
    await expect(mockJudge('any', '   ')).resolves.toMatchObject({ pass: false, score: 0 });
  });

  it('runs all built-in scenarios offline with the mock judge: all pass', async () => {
    const report = await runEval(SCENARIOS, mockJudge);
    expect(report.total).toBe(SCENARIOS.length);
    expect(report.passed).toBe(report.total);
    expect(report.totalScore).toBe(1);
  });

  it('built-in deterministic checks reflect real triage behaviour', async () => {
    // Run with a judge that would FAIL, to prove the deterministic checks pass on
    // their own (the security/bug/docs categorisation + ranking are real).
    const failingJudge: Judge = async () => ({ pass: false, score: 0, reason: 'forced fail' });
    const report = await runEval(SCENARIOS, failingJudge);

    const deterministicOnly = report.scenarios.filter((s) =>
      ['crash-bug-categorised', 'docs-categorised', 'security-outranks-cosmetic'].includes(s.id),
    );
    expect(deterministicOnly).toHaveLength(3);
    expect(deterministicOnly.every((s) => s.pass)).toBe(true);
  });
});
