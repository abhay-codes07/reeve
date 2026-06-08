/**
 * `github-search` namespace — search across GitHub.
 */

import { z } from 'zod';
import { defineTool, type AnyToolDefinition } from '../types.js';
import { pagination, issueSummary, repoSummary, mapIssueSummary, mapRepo } from '../schemas.js';

const NS = 'github-search' as const;
const query = z.string().min(1).describe('A GitHub search query string.');

const search_issues = defineTool({
  name: 'search_issues',
  namespace: NS,
  description: 'Search issues across GitHub using the issues/PRs search syntax.',
  inputSchema: z.object({
    query,
    sort: z.enum(['comments', 'created', 'updated']).optional(),
    order: z.enum(['asc', 'desc']).optional(),
    ...pagination,
  }),
  outputSchema: z.object({ totalCount: z.number(), items: z.array(issueSummary) }),
  handler: async (args, ctx) => {
    const { data } = await ctx.github.request('github.search.issues', (o) =>
      o.rest.search.issuesAndPullRequests({
        q: `${args.query} is:issue`,
        ...(args.sort ? { sort: args.sort } : {}),
        ...(args.order ? { order: args.order } : {}),
        ...(args.perPage ? { per_page: args.perPage } : {}),
        ...(args.page ? { page: args.page } : {}),
      }),
    );
    return { totalCount: data.total_count, items: data.items.map(mapIssueSummary) };
  },
});

const search_prs = defineTool({
  name: 'search_prs',
  namespace: NS,
  description: 'Search pull requests across GitHub using the issues/PRs search syntax.',
  inputSchema: z.object({
    query,
    sort: z.enum(['comments', 'created', 'updated']).optional(),
    order: z.enum(['asc', 'desc']).optional(),
    ...pagination,
  }),
  outputSchema: z.object({ totalCount: z.number(), items: z.array(issueSummary) }),
  handler: async (args, ctx) => {
    const { data } = await ctx.github.request('github.search.prs', (o) =>
      o.rest.search.issuesAndPullRequests({
        q: `${args.query} is:pr`,
        ...(args.sort ? { sort: args.sort } : {}),
        ...(args.order ? { order: args.order } : {}),
        ...(args.perPage ? { per_page: args.perPage } : {}),
        ...(args.page ? { page: args.page } : {}),
      }),
    );
    return { totalCount: data.total_count, items: data.items.map(mapIssueSummary) };
  },
});

const search_code = defineTool({
  name: 'search_code',
  namespace: NS,
  description: 'Search for code across GitHub matching a query.',
  inputSchema: z.object({ query, ...pagination }),
  outputSchema: z.object({
    totalCount: z.number(),
    items: z.array(
      z.object({
        name: z.string(),
        path: z.string(),
        repository: z.string(),
        sha: z.string(),
        url: z.string(),
      }),
    ),
  }),
  handler: async (args, ctx) => {
    const { data } = await ctx.github.request('github.search.code', (o) =>
      o.rest.search.code({
        q: args.query,
        ...(args.perPage ? { per_page: args.perPage } : {}),
        ...(args.page ? { page: args.page } : {}),
      }),
    );
    const items = data.items.map((i) => ({
      name: i.name,
      path: i.path,
      repository: i.repository?.full_name ?? '',
      sha: i.sha,
      url: i.html_url,
    }));
    return { totalCount: data.total_count, items };
  },
});

const search_repos = defineTool({
  name: 'search_repos',
  namespace: NS,
  description: 'Search for repositories across GitHub matching a query.',
  inputSchema: z.object({
    query,
    sort: z.enum(['stars', 'forks', 'updated', 'help-wanted-issues']).optional(),
    order: z.enum(['asc', 'desc']).optional(),
    ...pagination,
  }),
  outputSchema: z.object({ totalCount: z.number(), items: z.array(repoSummary) }),
  handler: async (args, ctx) => {
    const { data } = await ctx.github.request('github.search.repos', (o) =>
      o.rest.search.repos({
        q: args.query,
        ...(args.sort ? { sort: args.sort } : {}),
        ...(args.order ? { order: args.order } : {}),
        ...(args.perPage ? { per_page: args.perPage } : {}),
        ...(args.page ? { page: args.page } : {}),
      }),
    );
    return { totalCount: data.total_count, items: data.items.map(mapRepo) };
  },
});

const search_commits = defineTool({
  name: 'search_commits',
  namespace: NS,
  description: 'Search for commits across GitHub matching a query.',
  inputSchema: z.object({ query, ...pagination }),
  outputSchema: z.object({
    totalCount: z.number(),
    items: z.array(
      z.object({
        sha: z.string(),
        message: z.string(),
        author: z.string().nullable(),
        repository: z.string(),
        url: z.string(),
      }),
    ),
  }),
  handler: async (args, ctx) => {
    const { data } = await ctx.github.request('github.search.commits', (o) =>
      o.rest.search.commits({
        q: args.query,
        ...(args.perPage ? { per_page: args.perPage } : {}),
        ...(args.page ? { page: args.page } : {}),
      }),
    );
    const items = data.items.map((c) => ({
      sha: c.sha,
      message: c.commit?.message ?? '',
      author: c.author?.login ?? c.commit?.author?.name ?? null,
      repository: c.repository?.full_name ?? '',
      url: c.html_url,
    }));
    return { totalCount: data.total_count, items };
  },
});

const search_users = defineTool({
  name: 'search_users',
  namespace: NS,
  description: 'Search for users and organizations across GitHub matching a query.',
  inputSchema: z.object({ query, ...pagination }),
  outputSchema: z.object({
    totalCount: z.number(),
    items: z.array(
      z.object({
        login: z.string(),
        id: z.number(),
        type: z.string(),
        url: z.string(),
      }),
    ),
  }),
  handler: async (args, ctx) => {
    const { data } = await ctx.github.request('github.search.users', (o) =>
      o.rest.search.users({
        q: args.query,
        ...(args.perPage ? { per_page: args.perPage } : {}),
        ...(args.page ? { page: args.page } : {}),
      }),
    );
    const items = data.items.map((u) => ({
      login: u.login,
      id: u.id,
      type: u.type,
      url: u.html_url,
    }));
    return { totalCount: data.total_count, items };
  },
});

export const searchTools: AnyToolDefinition[] = [
  search_issues,
  search_prs,
  search_code,
  search_repos,
  search_commits,
  search_users,
];
