/**
 * `github-checks` namespace — inspect commit check runs and suites (CI status).
 */

import { z } from 'zod';
import { defineTool, type AnyToolDefinition } from '../types.js';
import { resolveRepo } from '../context.js';
import { repoTarget, pagination } from '../schemas.js';

const NS = 'github-checks' as const;

const checkRun = z.object({
  id: z.number(),
  name: z.string(),
  status: z.string().nullable(),
  conclusion: z.string().nullable(),
  headSha: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  url: z.string().nullable(),
});

function mapCheckRun(c: Record<string, any>): z.infer<typeof checkRun> {
  return {
    id: c.id,
    name: c.name,
    status: c.status ?? null,
    conclusion: c.conclusion ?? null,
    headSha: c.head_sha,
    startedAt: c.started_at ?? null,
    completedAt: c.completed_at ?? null,
    url: c.html_url ?? null,
  };
}

const checks_list_for_ref = defineTool({
  name: 'checks_list_for_ref',
  namespace: NS,
  description: 'List the check runs (CI results) for a commit ref.',
  inputSchema: z.object({
    ...repoTarget,
    ref: z.string().min(1).describe('Commit SHA, branch, or tag.'),
    ...pagination,
  }),
  outputSchema: z.object({ totalCount: z.number(), items: z.array(checkRun) }),
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.checks.listForRef', (o) =>
      o.rest.checks.listForRef({
        owner,
        repo,
        ref: args.ref,
        ...(args.perPage ? { per_page: args.perPage } : {}),
        ...(args.page ? { page: args.page } : {}),
      }),
    );
    return { totalCount: data.total_count, items: data.check_runs.map(mapCheckRun) };
  },
});

const checks_get_run = defineTool({
  name: 'checks_get_run',
  namespace: NS,
  description: 'Get a single check run by id.',
  inputSchema: z.object({ ...repoTarget, checkRunId: z.number().int().positive() }),
  outputSchema: checkRun,
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.checks.get', (o) =>
      o.rest.checks.get({ owner, repo, check_run_id: args.checkRunId }),
    );
    return mapCheckRun(data);
  },
});

const checks_list_suites = defineTool({
  name: 'checks_list_suites',
  namespace: NS,
  description: 'List the check suites for a commit ref.',
  inputSchema: z.object({ ...repoTarget, ref: z.string().min(1), ...pagination }),
  outputSchema: z.object({
    totalCount: z.number(),
    items: z.array(
      z.object({
        id: z.number(),
        status: z.string().nullable(),
        conclusion: z.string().nullable(),
        headBranch: z.string().nullable(),
        headSha: z.string(),
      }),
    ),
  }),
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.checks.listSuitesForRef', (o) =>
      o.rest.checks.listSuitesForRef({
        owner,
        repo,
        ref: args.ref,
        ...(args.perPage ? { per_page: args.perPage } : {}),
        ...(args.page ? { page: args.page } : {}),
      }),
    );
    const items = data.check_suites.map((s) => ({
      id: s.id,
      status: s.status ?? null,
      conclusion: s.conclusion ?? null,
      headBranch: s.head_branch ?? null,
      headSha: s.head_sha,
    }));
    return { totalCount: data.total_count, items };
  },
});

export const checkTools: AnyToolDefinition[] = [
  checks_list_for_ref,
  checks_get_run,
  checks_list_suites,
];
