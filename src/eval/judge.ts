/**
 * The LLM judge — the ONLY place the eval harness touches a live model.
 *
 * Fuzzy criteria (e.g. "is this drafted response on-topic and actionable?") are
 * scored by a small judge agent on google/gemini-2.5-flash-lite. It is isolated
 * behind the {@link Judge} function type so callers can swap in {@link mockJudge}
 * for fully offline runs, and so there is exactly one code path that hits Gemini.
 *
 * No live call happens at import time — `createLlmJudge` only constructs the
 * agent; the model is reached when the returned function is invoked.
 */

import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { workerModel } from '../config/index.js';

export interface JudgeVerdict {
  pass: boolean;
  /** 0..1 quality score. */
  score: number;
  reason: string;
}

/** A judge scores a piece of content against a single fuzzy criterion. */
export type Judge = (criterion: string, content: string) => Promise<JudgeVerdict>;

const verdictSchema = z.object({
  pass: z.boolean(),
  score: z.number().min(0).max(1),
  reason: z.string(),
});

const JUDGE_INSTRUCTIONS = `You are a strict but fair evaluation judge. You are given a CRITERION and some CONTENT. Decide whether the content satisfies the criterion. Respond with pass (boolean), score (0..1, how well it satisfies the criterion), and a one-sentence reason. Judge only what is present; do not invent.`;

/**
 * Build the live judge. The judge agent has NO tools, so it can use Gemini's
 * native structured-output response format directly (the function-calling +
 * JSON conflict that affects subagents does not apply here).
 */
export function createLlmJudge(): Judge {
  const agent = new Agent({
    id: 'reeve-eval-judge',
    name: 'Reeve Eval Judge',
    instructions: JUDGE_INSTRUCTIONS,
    model: workerModel,
  });

  return async (criterion, content) => {
    const result = await agent.generate(
      `CRITERION:\n${criterion}\n\nCONTENT:\n${content}`,
      { structuredOutput: { schema: verdictSchema } },
    );
    return verdictSchema.parse((result as { object?: unknown }).object);
  };
}

/**
 * Offline stub judge. Deterministic, hits no model: passes on non-empty content.
 * Used by `pnpm eval --mock` and by tests so the harness runs fully offline.
 */
export const mockJudge: Judge = async (_criterion, content) => {
  const ok = content.trim().length > 0;
  return {
    pass: ok,
    score: ok ? 1 : 0,
    reason: ok
      ? 'stub judge (offline): content present, passed without model evaluation'
      : 'stub judge (offline): empty content',
  };
};

/** True for Gemini free-tier rate-limit / quota errors. */
export function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return msg.includes('quota') || msg.includes('rate limit') || msg.includes('429');
}
