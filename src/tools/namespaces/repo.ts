/**
 * `github-repo` namespace — inspect repository content and history.
 */

import { z } from 'zod';
import { defineTool, type AnyToolDefinition } from '../types.js';
import { resolveRepo } from '../context.js';
import { ValidationError } from '../../errors/index.js';
import {
  repoTarget,
  pagination,
  repoSummary,
  branchRef,
  commitSummary,
  fileChange,
  mapRepo,
  mapBranch,
  mapCommit,
  mapFileChange,
} from '../schemas.js';

const NS = 'github-repo' as const;

const repo_get = defineTool({
  name: 'repo_get',
  namespace: NS,
  description: 'Get repository metadata: description, default branch, stars, topics, counts.',
  inputSchema: z.object({ ...repoTarget }),
  outputSchema: repoSummary,
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.repos.get', (o) =>
      o.rest.repos.get({ owner, repo }),
    );
    return mapRepo(data);
  },
});

const repo_list_branches = defineTool({
  name: 'repo_list_branches',
  namespace: NS,
  description: 'List the branches of a repository.',
  inputSchema: z.object({ ...repoTarget, ...pagination }),
  outputSchema: z.object({ count: z.number(), items: z.array(branchRef) }),
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.repos.listBranches', (o) =>
      o.rest.repos.listBranches({
        owner,
        repo,
        ...(args.perPage ? { per_page: args.perPage } : {}),
        ...(args.page ? { page: args.page } : {}),
      }),
    );
    const items = data.map(mapBranch);
    return { count: items.length, items };
  },
});

const repo_get_branch = defineTool({
  name: 'repo_get_branch',
  namespace: NS,
  description: 'Get a single branch, including its head commit and protection flag.',
  inputSchema: z.object({ ...repoTarget, branch: z.string().min(1) }),
  outputSchema: branchRef,
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.repos.getBranch', (o) =>
      o.rest.repos.getBranch({ owner, repo, branch: args.branch }),
    );
    return mapBranch(data);
  },
});

const contentEntry = z.object({
  name: z.string(),
  path: z.string(),
  type: z.string(),
  size: z.number(),
  sha: z.string(),
});

const repo_list_contents = defineTool({
  name: 'repo_list_contents',
  namespace: NS,
  description: 'List the entries of a directory in the repository at a path/ref.',
  inputSchema: z.object({
    ...repoTarget,
    path: z.string().default('').describe('Directory path; empty for the root.'),
    ref: z.string().optional().describe('Branch, tag, or commit SHA.'),
  }),
  outputSchema: z.object({ count: z.number(), items: z.array(contentEntry) }),
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.repos.getContentDir', (o) =>
      o.rest.repos.getContent({
        owner,
        repo,
        path: args.path,
        ...(args.ref ? { ref: args.ref } : {}),
      }),
    );
    if (!Array.isArray(data)) {
      throw new ValidationError(`Path "${args.path}" is not a directory.`, {
        operation: 'repo_list_contents',
        path: args.path,
      });
    }
    const items = data.map((e) => ({
      name: e.name,
      path: e.path,
      type: e.type,
      size: e.size,
      sha: e.sha,
    }));
    return { count: items.length, items };
  },
});

const repo_get_file = defineTool({
  name: 'repo_get_file',
  namespace: NS,
  description: 'Get the decoded text content of a file at a path/ref.',
  inputSchema: z.object({
    ...repoTarget,
    path: z.string().min(1),
    ref: z.string().optional(),
  }),
  outputSchema: z.object({
    path: z.string(),
    sha: z.string(),
    size: z.number(),
    encoding: z.string(),
    content: z.string(),
  }),
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.repos.getContentFile', (o) =>
      o.rest.repos.getContent({
        owner,
        repo,
        path: args.path,
        ...(args.ref ? { ref: args.ref } : {}),
      }),
    );
    if (Array.isArray(data) || data.type !== 'file') {
      throw new ValidationError(`Path "${args.path}" is not a file.`, {
        operation: 'repo_get_file',
        path: args.path,
      });
    }
    const raw = 'content' in data ? data.content : '';
    const content =
      data.encoding === 'base64' ? Buffer.from(raw, 'base64').toString('utf-8') : raw;
    return {
      path: data.path,
      sha: data.sha,
      size: data.size,
      encoding: 'utf-8',
      content,
    };
  },
});

const repo_list_commits = defineTool({
  name: 'repo_list_commits',
  namespace: NS,
  description: 'List commits on the repository, filterable by branch, path, or author.',
  inputSchema: z.object({
    ...repoTarget,
    sha: z.string().optional().describe('Branch name or commit SHA to start from.'),
    path: z.string().optional(),
    author: z.string().optional(),
    ...pagination,
  }),
  outputSchema: z.object({ count: z.number(), items: z.array(commitSummary) }),
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.repos.listCommits', (o) =>
      o.rest.repos.listCommits({
        owner,
        repo,
        ...(args.sha ? { sha: args.sha } : {}),
        ...(args.path ? { path: args.path } : {}),
        ...(args.author ? { author: args.author } : {}),
        ...(args.perPage ? { per_page: args.perPage } : {}),
        ...(args.page ? { page: args.page } : {}),
      }),
    );
    const items = data.map(mapCommit);
    return { count: items.length, items };
  },
});

const repo_get_commit = defineTool({
  name: 'repo_get_commit',
  namespace: NS,
  description: 'Get a single commit with its stats and changed files.',
  inputSchema: z.object({ ...repoTarget, ref: z.string().min(1).describe('Commit SHA or ref.') }),
  outputSchema: commitSummary.extend({
    additions: z.number(),
    deletions: z.number(),
    files: z.array(fileChange),
  }),
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.repos.getCommit', (o) =>
      o.rest.repos.getCommit({ owner, repo, ref: args.ref }),
    );
    return {
      ...mapCommit(data),
      additions: data.stats?.additions ?? 0,
      deletions: data.stats?.deletions ?? 0,
      files: (data.files ?? []).map(mapFileChange),
    };
  },
});

const repo_compare_commits = defineTool({
  name: 'repo_compare_commits',
  namespace: NS,
  description: 'Compare two commits/branches and summarise the diff between them.',
  inputSchema: z.object({
    ...repoTarget,
    base: z.string().min(1),
    head: z.string().min(1),
  }),
  outputSchema: z.object({
    status: z.string(),
    aheadBy: z.number(),
    behindBy: z.number(),
    totalCommits: z.number(),
    files: z.array(fileChange),
  }),
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.repos.compareCommits', (o) =>
      o.rest.repos.compareCommitsWithBasehead({
        owner,
        repo,
        basehead: `${args.base}...${args.head}`,
      }),
    );
    return {
      status: data.status,
      aheadBy: data.ahead_by,
      behindBy: data.behind_by,
      totalCommits: data.total_commits,
      files: (data.files ?? []).map(mapFileChange),
    };
  },
});

const repo_list_contributors = defineTool({
  name: 'repo_list_contributors',
  namespace: NS,
  description: 'List repository contributors ranked by contribution count.',
  inputSchema: z.object({ ...repoTarget, ...pagination }),
  outputSchema: z.object({
    count: z.number(),
    items: z.array(z.object({ login: z.string().nullable(), contributions: z.number() })),
  }),
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.repos.listContributors', (o) =>
      o.rest.repos.listContributors({
        owner,
        repo,
        ...(args.perPage ? { per_page: args.perPage } : {}),
        ...(args.page ? { page: args.page } : {}),
      }),
    );
    const items = data.map((c) => ({ login: c.login ?? null, contributions: c.contributions }));
    return { count: items.length, items };
  },
});

const repo_list_languages = defineTool({
  name: 'repo_list_languages',
  namespace: NS,
  description: 'Get the language byte breakdown of the repository.',
  inputSchema: z.object({ ...repoTarget }),
  outputSchema: z.object({ languages: z.record(z.string(), z.number()) }),
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.repos.listLanguages', (o) =>
      o.rest.repos.listLanguages({ owner, repo }),
    );
    return { languages: data as Record<string, number> };
  },
});

const repo_list_topics = defineTool({
  name: 'repo_list_topics',
  namespace: NS,
  description: 'List the topics (tags) applied to the repository.',
  inputSchema: z.object({ ...repoTarget }),
  outputSchema: z.object({ topics: z.array(z.string()) }),
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.repos.getAllTopics', (o) =>
      o.rest.repos.getAllTopics({ owner, repo }),
    );
    return { topics: data.names };
  },
});

export const repoTools: AnyToolDefinition[] = [
  repo_get,
  repo_list_branches,
  repo_get_branch,
  repo_list_contents,
  repo_get_file,
  repo_list_commits,
  repo_get_commit,
  repo_compare_commits,
  repo_list_contributors,
  repo_list_languages,
  repo_list_topics,
];
