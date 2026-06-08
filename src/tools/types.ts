/**
 * Core types for Reeve's tool registry.
 *
 * A tool is a typed wrapper around a single GitHub operation: a zod input
 * schema, a zod output schema, a one-line model-facing description, and a
 * handler that talks to GitHub *only* through the Step-2 {@link GitHubClient}.
 * The registry (see `registry.ts`) is the single source of truth; the exposure
 * layer (see `exposure.ts`) lets the orchestrator discover and invoke tools by
 * name without ever holding all definitions in context.
 */

import type { z } from 'zod';
import type { GitHubClient } from '../github/index.js';
import type { Env } from '../config/index.js';
import type { Logger } from '../observability/index.js';

/** The MCP-style namespaces tools are grouped under. */
export const NAMESPACES = {
  'github-issues': 'Read and manage issues: list, inspect, create, edit, label, assign, comment, lock, and close/reopen.',
  'github-prs': 'Work with pull requests: list, inspect diffs/files/commits, review, request reviewers, check mergeability, and merge.',
  'github-repo': 'Inspect repository content and history: metadata, branches, files, commits, comparisons, contributors, languages, topics.',
  'github-actions': 'Observe and control GitHub Actions: workflows, runs, jobs, logs, re-run and cancel.',
  'github-search': 'Search across GitHub: issues, pull requests, code, repositories, commits, and users.',
  'github-checks': 'Inspect commit check runs and check suites (CI status for a ref).',
  'github-releases': 'Inspect repository releases: list, get by id/tag, and latest.',
} as const;

/** A known namespace identifier. */
export type Namespace = keyof typeof NAMESPACES;

/** Everything a tool handler needs at call time. Injected by the caller. */
export interface ToolContext {
  /** The single GitHub choke point. Handlers never construct their own Octokit. */
  github: GitHubClient;
  /** Validated environment (provides the default sandbox `owner/repo`). */
  env: Env;
  /** Optional logger; handlers usually log through `github.request`. */
  logger?: Logger;
}

/**
 * A registered tool. The handler receives validated input and the context, and
 * returns a value that conforms to `outputSchema`. Handlers map GitHub
 * responses into compact, typed outputs rather than echoing raw payloads.
 */
export interface ToolDefinition<
  I extends z.ZodTypeAny = z.ZodTypeAny,
  O extends z.ZodTypeAny = z.ZodTypeAny,
> {
  /** Globally unique, function-call-safe name, e.g. `issues_list`. */
  name: string;
  /** Owning namespace. */
  namespace: Namespace;
  /** One line, strong enough for model-driven selection. */
  description: string;
  inputSchema: I;
  outputSchema: O;
  handler: (args: z.infer<I>, ctx: ToolContext) => Promise<z.infer<O>>;
}

/**
 * A tool definition with its schema types erased — what the registry stores and
 * iterates over. The handler arg is `any` here (it was validated against the
 * concrete `inputSchema` before the handler runs), which lets any concrete
 * {@link ToolDefinition} be stored without fighting generic-function variance.
 */
export interface AnyToolDefinition {
  name: string;
  namespace: Namespace;
  description: string;
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
  handler: (args: any, ctx: ToolContext) => Promise<unknown>;
}

/**
 * Identity helper that preserves the input/output schema types so handler
 * `args` and return values are fully inferred (and checked) at the definition
 * site, then widens to {@link AnyToolDefinition} for storage in the registry.
 */
export function defineTool<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  def: ToolDefinition<I, O>,
): AnyToolDefinition {
  return def;
}
