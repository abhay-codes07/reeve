/**
 * The orchestrator agent.
 *
 * A Mastra Agent on the orchestrator model (gemini-2.5-flash with a flash-lite
 * fallback). It is given ONLY four tools — the progressive-exposure surface — so
 * the 58-tool registry never enters the prompt at once. The model discovers what
 * exists (`list_namespaces` -> `list_tools` -> `get_tool_schema`) and acts
 * (`invoke_tool`). Tool selection is entirely the model's job: there is no
 * hand-coded routing anywhere in this file.
 */

import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { orchestratorModel } from '../config/index.js';
import type { ToolContext } from '../tools/index.js';
import {
  registry as defaultRegistry,
  listNamespaces,
  listTools,
  getToolSchema,
  invokeTool,
  ToolRegistry,
} from '../tools/index.js';
import { loadEnv } from '../config/index.js';
import { getGitHubClient } from '../github/index.js';
import { isReeveError } from '../errors/index.js';

export const ORCHESTRATOR_INSTRUCTIONS = `You are Reeve, an autonomous maintainer for a single GitHub repository (the "sandbox" repo configured in the environment).

You maintain the repo the way a senior maintainer would: triage issues, review pull requests, investigate regressions, and keep the backlog coherent.

You have a large toolset, but it is NOT all visible at once. You must DISCOVER tools before using them:
  1. Call list_namespaces to see the families of tools available.
  2. Call list_tools(namespace) to see the tools in a family, with one-line descriptions.
  3. Call get_tool_schema(toolName) to see a tool's exact input/output JSON schema.
  4. Call invoke_tool(toolName, args) to run a tool. Always match the schema from step 3.

Rules:
  - Choose tools yourself based on their descriptions and schemas. Never assume a tool exists without discovering it.
  - Most repo tools default owner/repo to the sandbox repo; omit them unless operating elsewhere.
  - invoke_tool returns { ok, result } on success or { ok:false, errorCode, error } on failure. If a call fails, read the error, adjust your arguments or approach, and retry sensibly rather than giving up.
  - Prefer read-only discovery before any write (create/update/comment/merge/close).
  - Tools compose: e.g. search_issues -> cluster_issues -> draft_triage_report produces a ranked triage backlog. Pass one tool's result straight into the next.
  - Keep a clear plan across multi-step work and report what you did and why.`;

/** Build the four exposure tools, bound to a registry + execution context. */
export function buildExposureTools(ctx: ToolContext, registry: ToolRegistry = defaultRegistry) {
  const list_namespaces = createTool({
    id: 'list_namespaces',
    description: 'List the available tool namespaces (families), each with a description and tool count.',
    inputSchema: z.object({}),
    outputSchema: z.object({
      namespaces: z.array(
        z.object({ namespace: z.string(), description: z.string(), toolCount: z.number() }),
      ),
    }),
    execute: async () => ({ namespaces: listNamespaces(registry) }),
  });

  const list_tools = createTool({
    id: 'list_tools',
    description: 'List the tools in a namespace, with one-line descriptions, to choose from.',
    inputSchema: z.object({ namespace: z.string().describe('A namespace from list_namespaces.') }),
    outputSchema: z.object({
      tools: z.array(z.object({ name: z.string(), description: z.string() })),
    }),
    execute: async (input) => ({ tools: listTools(registry, input.namespace) }),
  });

  const get_tool_schema = createTool({
    id: 'get_tool_schema',
    description: 'Get the full input and output JSON schema for a single tool before invoking it.',
    inputSchema: z.object({ toolName: z.string() }),
    outputSchema: z.object({
      name: z.string(),
      namespace: z.string(),
      description: z.string(),
      inputSchema: z.unknown(),
      outputSchema: z.unknown(),
    }),
    execute: async (input) => getToolSchema(registry, input.toolName),
  });

  const invoke_tool = createTool({
    id: 'invoke_tool',
    description:
      'Invoke a tool by name with arguments matching its input schema. Returns { ok, result } or { ok:false, errorCode, error }.',
    inputSchema: z.object({
      toolName: z.string(),
      args: z.record(z.string(), z.unknown()).optional().describe('Arguments object for the tool.'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      result: z.unknown().optional(),
      errorCode: z.string().optional(),
      error: z.string().optional(),
    }),
    execute: async (input) => {
      try {
        const result = await invokeTool(registry, input.toolName, input.args ?? {}, ctx);
        return { ok: true, result };
      } catch (err) {
        if (isReeveError(err)) {
          return { ok: false, errorCode: err.code, error: err.message };
        }
        return {
          ok: false,
          errorCode: 'UNKNOWN',
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });

  return { list_namespaces, list_tools, get_tool_schema, invoke_tool };
}

/** Create the orchestrator agent bound to an explicit execution context. */
export function createOrchestrator(
  ctx: ToolContext,
  registry: ToolRegistry = defaultRegistry,
): Agent {
  return new Agent({
    id: 'reeve-orchestrator',
    name: 'Reeve Orchestrator',
    instructions: ORCHESTRATOR_INSTRUCTIONS,
    model: orchestratorModel,
    tools: buildExposureTools(ctx, registry),
  });
}

/**
 * Convenience: build the orchestrator from the validated environment, wiring a
 * real GitHub client. Throws (via loadEnv) if configuration is missing.
 */
export function createDefaultOrchestrator(): Agent {
  const env = loadEnv();
  const github = getGitHubClient(env);
  return createOrchestrator({ github, env });
}
