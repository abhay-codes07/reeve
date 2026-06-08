/**
 * Progressive exposure layer.
 *
 * These four operations are the ENTIRE surface the orchestrator sees of the
 * tool registry. The 50+ tool definitions are never dumped into the prompt;
 * instead the model discovers them:
 *
 *   1. `list_namespaces()`        — what families of tools exist
 *   2. `list_tools(namespace)`    — names + one-line descriptions in a family
 *   3. `get_tool_schema(name)`    — full input/output JSON schema for one tool
 *   4. `invoke_tool(name, args)`  — validate args and run the tool's handler
 *
 * `invoke_tool` is a MECHANICAL dispatcher: it looks the tool up by the name the
 * model supplies, validates the args against that tool's zod input schema, runs
 * the handler, and validates the output. It contains NO logic that decides
 * which tool to use — selection stays entirely model-driven.
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ToolContext } from './types.js';
import { NAMESPACES } from './types.js';
import type { ToolRegistry } from './registry.js';
import { ValidationError, isReeveError } from '../errors/index.js';

export interface NamespaceInfo {
  namespace: string;
  description: string;
  toolCount: number;
}

export interface ToolListing {
  name: string;
  description: string;
}

export interface ToolSchema {
  name: string;
  namespace: string;
  description: string;
  inputSchema: unknown;
  outputSchema: unknown;
}

/** (1) List every namespace that has tools, with a description and count. */
export function listNamespaces(registry: ToolRegistry): NamespaceInfo[] {
  return registry.namespaces().map((namespace) => ({
    namespace,
    description: NAMESPACES[namespace],
    toolCount: registry.byNamespace(namespace).length,
  }));
}

/** (2) List the tools in a namespace — names + descriptions only. */
export function listTools(registry: ToolRegistry, namespace: string): ToolListing[] {
  return registry.byNamespace(namespace).map((t) => ({
    name: t.name,
    description: t.description,
  }));
}

/** (3) Full input/output JSON schema for a single tool. */
export function getToolSchema(registry: ToolRegistry, toolName: string): ToolSchema {
  const tool = registry.get(toolName);
  return {
    name: tool.name,
    namespace: tool.namespace,
    description: tool.description,
    inputSchema: zodToJsonSchema(tool.inputSchema, { target: 'jsonSchema7', $refStrategy: 'none' }),
    outputSchema: zodToJsonSchema(tool.outputSchema, { target: 'jsonSchema7', $refStrategy: 'none' }),
  };
}

/**
 * (4) Mechanical dispatcher. Validates `args` against the named tool's input
 * schema, runs its handler with `ctx`, and validates the result against the
 * output schema. Errors are always {@link ReeveError}s:
 *  - bad args            -> ValidationError (with the zod issues)
 *  - GitHub failures     -> mapped taxonomy error (from the client)
 *  - malformed output    -> ValidationError (internal contract bug)
 */
export async function invokeTool(
  registry: ToolRegistry,
  toolName: string,
  args: unknown,
  ctx: ToolContext,
): Promise<unknown> {
  const tool = registry.get(toolName); // throws NotFoundError for unknown names

  const parsedInput = tool.inputSchema.safeParse(args ?? {});
  if (!parsedInput.success) {
    const details = parsedInput.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new ValidationError(`Invalid arguments for tool "${toolName}": ${details}`, {
      operation: 'invoke_tool',
      tool: toolName,
      issues: parsedInput.error.issues,
    });
  }

  let result: unknown;
  try {
    result = await tool.handler(parsedInput.data, ctx);
  } catch (err) {
    // Handlers call GitHub through the client, which already maps to the
    // taxonomy. Anything already typed passes straight through.
    if (isReeveError(err)) throw err;
    throw new ValidationError(`Tool "${toolName}" handler failed unexpectedly.`, {
      operation: 'invoke_tool',
      tool: toolName,
      cause: err instanceof Error ? err.message : String(err),
    });
  }

  const parsedOutput = tool.outputSchema.safeParse(result);
  if (!parsedOutput.success) {
    throw new ValidationError(
      `Tool "${toolName}" produced output that failed its own schema.`,
      {
        operation: 'invoke_tool',
        tool: toolName,
        issues: parsedOutput.error.issues,
      },
    );
  }
  return parsedOutput.data;
}
