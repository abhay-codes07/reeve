/**
 * Shared model configuration for Reeve, using Mastra's model router.
 *
 * Two roles, per the architecture in CLAUDE.md:
 *
 *  - **orchestrator** — the routing agent and the long-horizon `triage_repository`
 *    task. Configured as a FALLBACK CHAIN: try `gemini-2.5-flash` first, then
 *    degrade to `gemini-2.5-flash-lite`, each with its own retry budget. Mastra
 *    retries within a model on 429 / 5xx / timeout up to `maxRetries`, then moves
 *    to the next entry (resetting the counter). This absorbs free-tier rate
 *    limits and transient upstream errors gracefully.
 *
 *  - **worker** — isolated subagents and the eval LLM judge. A single, cheaper
 *    `gemini-2.5-flash-lite`; workers are scoped and short-lived, so a fallback
 *    chain would add cost without much benefit.
 *
 * Model ids use Mastra's router string format `provider/model-id` and were
 * confirmed against the Mastra docs (June 2026). The router reads the Google key
 * from `GOOGLE_GENERATIVE_AI_API_KEY` (the @ai-sdk/google convention), validated
 * by {@link loadEnv}. The runtime is provider-swappable: change these strings.
 */

import type { ModelWithRetries } from '@mastra/core/agent';

/** Mastra model-router ids (provider/model-id form). */
export const MODEL_IDS = {
  flash: 'google/gemini-2.5-flash',
  flashLite: 'google/gemini-2.5-flash-lite',
} as const;

/**
 * Orchestrator model: fallback chain flash -> flash-lite with per-model retries.
 * Typed as `ModelWithRetries[]`, the shape Mastra's `Agent.model` field accepts
 * for fallback/load-balancing.
 */
export const orchestratorModel: ModelWithRetries[] = [
  { model: MODEL_IDS.flash, maxRetries: 3 },
  { model: MODEL_IDS.flashLite, maxRetries: 2 },
];

/** Worker model: a single cheaper model for scoped subagents and the eval judge. */
export const workerModel = MODEL_IDS.flashLite;

/** Named roles, for convenient injection into agents/evals. */
export const models = {
  orchestrator: orchestratorModel,
  worker: workerModel,
} as const;
