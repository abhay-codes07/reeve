/**
 * Subagent runner — the real isolation boundary (CLAUDE.md invariant #2).
 *
 * Why this is genuine isolation and not a relabelled function call:
 *
 *  1. SEPARATE AGENT. Each subagent is its own `new Agent(...)` instance on the
 *     worker model (gemini-2.5-flash-lite), distinct from the orchestrator. It
 *     shares no object, no instructions, and no model config with the parent.
 *  2. NO PARENT CONTEXT. The subagent is invoked with ONLY a task brief (a plain
 *     string built from the task parameters). It has no Memory store attached, so
 *     every run starts from an empty thread — there is no parent conversation or
 *     prior turn to read. Each run is tagged with a fresh `threadId`.
 *  3. SCOPED TOOLS. The subagent drives a SCOPED registry (`registry.subset`)
 *     that physically contains only its read-only tool subset. Its four
 *     progressive-exposure tools operate over that scoped registry, so it cannot
 *     even discover — let alone invoke — anything outside its scope.
 *  4. STRUCTURED RETURN. It must emit a typed object validated against a zod
 *     schema. The parent receives only that object, not the subagent's transcript.
 */

import { randomUUID } from 'node:crypto';
import { Agent } from '@mastra/core/agent';
import type { z } from 'zod';
import { workerModel } from '../../config/index.js';
import { registry as baseRegistry, type ToolContext, type ToolRegistry } from '../../tools/index.js';
import { buildExposureTools } from '../orchestrator.js';
import { createOperationLogger } from '../../observability/index.js';

export interface SubagentSpec {
  /** Stable agent id, e.g. `reeve-subagent-review-pr`. */
  id: string;
  /** Human-readable agent name. */
  name: string;
  /** The subagent's OWN system prompt (not the orchestrator's). */
  instructions: string;
  /** The read-only tool names this subagent may use — its entire world. */
  scope: readonly string[];
}

export interface SubagentHandle {
  agent: Agent;
  /** The scoped registry — physically limited to {@link SubagentSpec.scope}. */
  scopedRegistry: ToolRegistry;
  /** The four exposure tools, bound to the scoped registry. */
  tools: ReturnType<typeof buildExposureTools>;
  /** A fresh, unique thread id for this subagent instance. */
  threadId: string;
  scope: readonly string[];
}

/**
 * Construct an isolated subagent. Pure and side-effect-free, so tests can assert
 * the scope and wiring without invoking the model. The scoped registry is built
 * from the base (subagent-free) registry, so subagents never reach each other.
 */
export function createSubagent(
  ctx: ToolContext,
  spec: SubagentSpec,
  source: ToolRegistry = baseRegistry,
): SubagentHandle {
  const scopedRegistry = source.subset(spec.scope);
  const tools = buildExposureTools(ctx, scopedRegistry);
  const threadId = randomUUID();
  const agent = new Agent({
    id: spec.id,
    name: spec.name,
    instructions: spec.instructions,
    model: workerModel,
    tools,
  });
  return { agent, scopedRegistry, tools, threadId, scope: spec.scope };
}

/**
 * Run a subagent to completion on a single brief and return its validated typed
 * result. The brief is the ONLY input the subagent sees.
 */
export async function runSubagent<S extends z.ZodTypeAny>(
  ctx: ToolContext,
  spec: SubagentSpec,
  brief: string,
  schema: S,
  maxSteps = 12,
): Promise<z.infer<S>> {
  const { agent, threadId } = createSubagent(ctx, spec);
  const log = createOperationLogger({ operation: `subagent.${spec.id}`, threadId }, ctx.logger);
  log.info({ scope: spec.scope }, 'subagent.start');

  const result = await agent.generate(brief, {
    // Give structuredOutput its OWN structuring model. The main agent calls
    // tools (no response_format), then a separate, tools-free structuring pass
    // emits the typed JSON via native response_format. This sidesteps Gemini's
    // rejection of a JSON response mime type in the same request as function
    // calling, and populates `result.object`.
    structuredOutput: { schema, model: workerModel },
    maxSteps,
  });

  const object = (result as { object?: unknown }).object;
  const parsed = schema.parse(object);
  log.info('subagent.done');
  return parsed;
}
