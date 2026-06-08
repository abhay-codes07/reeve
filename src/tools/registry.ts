/**
 * The tool registry — single source of truth.
 *
 * Records every tool by its unique name with namespace, description, input and
 * output schemas, and handler. The orchestrator never sees this directly; it
 * reaches the registry through the exposure layer so 50+ definitions never sit
 * in the prompt at once.
 */

import type { AnyToolDefinition, Namespace } from './types.js';
import { NAMESPACES } from './types.js';
import { ValidationError, NotFoundError } from '../errors/index.js';

export class ToolRegistry {
  private readonly tools = new Map<string, AnyToolDefinition>();

  /** Register one tool. Throws on a duplicate name or unknown namespace. */
  register(tool: AnyToolDefinition): this {
    if (this.tools.has(tool.name)) {
      throw new ValidationError(`Duplicate tool name: ${tool.name}`, {
        operation: 'registry.register',
        tool: tool.name,
      });
    }
    if (!(tool.namespace in NAMESPACES)) {
      throw new ValidationError(`Unknown namespace: ${tool.namespace}`, {
        operation: 'registry.register',
        tool: tool.name,
        namespace: tool.namespace,
      });
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  /** Register many tools. */
  registerAll(tools: readonly AnyToolDefinition[]): this {
    for (const tool of tools) this.register(tool);
    return this;
  }

  /** Whether a tool name is registered. */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Get a tool by name, or throw {@link NotFoundError}. */
  get(name: string): AnyToolDefinition {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new NotFoundError(`No such tool: ${name}`, {
        operation: 'registry.get',
        tool: name,
      });
    }
    return tool;
  }

  /** All registered tools. */
  all(): AnyToolDefinition[] {
    return [...this.tools.values()];
  }

  /** Total tool count. */
  get size(): number {
    return this.tools.size;
  }

  /** Namespaces that actually have at least one registered tool. */
  namespaces(): Namespace[] {
    const seen = new Set<Namespace>();
    for (const tool of this.tools.values()) seen.add(tool.namespace);
    return [...seen];
  }

  /** Tools within a namespace. Throws {@link NotFoundError} for unknown ones. */
  byNamespace(namespace: string): AnyToolDefinition[] {
    if (!(namespace in NAMESPACES)) {
      throw new NotFoundError(`No such namespace: ${namespace}`, {
        operation: 'registry.byNamespace',
        namespace,
      });
    }
    return this.all().filter((t) => t.namespace === namespace);
  }
}
