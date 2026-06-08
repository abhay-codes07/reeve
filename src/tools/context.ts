/**
 * Small helpers shared by tool handlers.
 */

import type { ToolContext } from './types.js';

/** Resolve an optional `owner`/`repo` pair, defaulting to the sandbox repo. */
export function resolveRepo(
  args: { owner?: string | undefined; repo?: string | undefined },
  ctx: ToolContext,
): { owner: string; repo: string } {
  return {
    owner: args.owner ?? ctx.env.sandbox.owner,
    repo: args.repo ?? ctx.env.sandbox.repo,
  };
}
