/**
 * `github-prs` namespace — work with pull requests.
 */

import { z } from 'zod';
import { defineTool, type AnyToolDefinition } from '../types.js';
import { resolveRepo } from '../context.js';
import {
  repoTarget,
  pagination,
  prSummary,
  prDetail,
  commitSummary,
  fileChange,
  commentSummary,
  mapPrSummary,
  mapPrDetail,
  mapCommit,
  mapFileChange,
  mapComment,
} from '../schemas.js';

const NS = 'github-prs' as const;
const pullNumber = z.number().int().positive().describe('The pull request number.');

const prs_list = defineTool({
  name: 'prs_list',
  namespace: NS,
  description: 'List pull requests, filterable by state and base/head branch.',
  inputSchema: z.object({
    ...repoTarget,
    state: z.enum(['open', 'closed', 'all']).optional(),
    base: z.string().optional(),
    head: z.string().optional(),
    sort: z.enum(['created', 'updated', 'popularity', 'long-running']).optional(),
    direction: z.enum(['asc', 'desc']).optional(),
    ...pagination,
  }),
  outputSchema: z.object({ count: z.number(), items: z.array(prSummary) }),
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.pulls.list', (o) =>
      o.rest.pulls.list({
        owner,
        repo,
        ...(args.state ? { state: args.state } : {}),
        ...(args.base ? { base: args.base } : {}),
        ...(args.head ? { head: args.head } : {}),
        ...(args.sort ? { sort: args.sort } : {}),
        ...(args.direction ? { direction: args.direction } : {}),
        ...(args.perPage ? { per_page: args.perPage } : {}),
        ...(args.page ? { page: args.page } : {}),
      }),
    );
    const items = data.map(mapPrSummary);
    return { count: items.length, items };
  },
});

const prs_get = defineTool({
  name: 'prs_get',
  namespace: NS,
  description: 'Get a pull request with body, merge state, and change stats.',
  inputSchema: z.object({ ...repoTarget, pullNumber }),
  outputSchema: prDetail,
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.pulls.get', (o) =>
      o.rest.pulls.get({ owner, repo, pull_number: args.pullNumber }),
    );
    return mapPrDetail(data);
  },
});

const prs_get_diff = defineTool({
  name: 'prs_get_diff',
  namespace: NS,
  description: 'Get the unified diff text of a pull request.',
  inputSchema: z.object({ ...repoTarget, pullNumber }),
  outputSchema: z.object({ pullNumber: z.number(), diff: z.string() }),
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const res = await ctx.github.request('github.pulls.getDiff', (o) =>
      o.rest.pulls.get({
        owner,
        repo,
        pull_number: args.pullNumber,
        mediaType: { format: 'diff' },
      }),
    );
    // With the diff media type GitHub returns raw text, not the PR object.
    return { pullNumber: args.pullNumber, diff: res.data as unknown as string };
  },
});

const prs_list_files = defineTool({
  name: 'prs_list_files',
  namespace: NS,
  description: 'List the files changed in a pull request with per-file stats.',
  inputSchema: z.object({ ...repoTarget, pullNumber, ...pagination }),
  outputSchema: z.object({ count: z.number(), items: z.array(fileChange) }),
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.pulls.listFiles', (o) =>
      o.rest.pulls.listFiles({
        owner,
        repo,
        pull_number: args.pullNumber,
        ...(args.perPage ? { per_page: args.perPage } : {}),
        ...(args.page ? { page: args.page } : {}),
      }),
    );
    const items = data.map(mapFileChange);
    return { count: items.length, items };
  },
});

const prs_list_commits = defineTool({
  name: 'prs_list_commits',
  namespace: NS,
  description: 'List the commits contained in a pull request.',
  inputSchema: z.object({ ...repoTarget, pullNumber, ...pagination }),
  outputSchema: z.object({ count: z.number(), items: z.array(commitSummary) }),
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.pulls.listCommits', (o) =>
      o.rest.pulls.listCommits({
        owner,
        repo,
        pull_number: args.pullNumber,
        ...(args.perPage ? { per_page: args.perPage } : {}),
        ...(args.page ? { page: args.page } : {}),
      }),
    );
    const items = data.map(mapCommit);
    return { count: items.length, items };
  },
});

const reviewSummary = z.object({
  id: z.number(),
  reviewer: z.string().nullable(),
  state: z.string(),
  body: z.string().nullable(),
  submittedAt: z.string().nullable(),
});

const prs_list_reviews = defineTool({
  name: 'prs_list_reviews',
  namespace: NS,
  description: 'List the reviews submitted on a pull request.',
  inputSchema: z.object({ ...repoTarget, pullNumber, ...pagination }),
  outputSchema: z.object({ count: z.number(), items: z.array(reviewSummary) }),
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.pulls.listReviews', (o) =>
      o.rest.pulls.listReviews({
        owner,
        repo,
        pull_number: args.pullNumber,
        ...(args.perPage ? { per_page: args.perPage } : {}),
        ...(args.page ? { page: args.page } : {}),
      }),
    );
    const items = data.map((r) => ({
      id: r.id,
      reviewer: r.user?.login ?? null,
      state: r.state,
      body: r.body ?? null,
      submittedAt: r.submitted_at ?? null,
    }));
    return { count: items.length, items };
  },
});

const prs_create_review = defineTool({
  name: 'prs_create_review',
  namespace: NS,
  description: 'Submit a review on a pull request (approve, request changes, or comment).',
  inputSchema: z.object({
    ...repoTarget,
    pullNumber,
    event: z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']),
    body: z.string().optional().describe('Review body; required for REQUEST_CHANGES/COMMENT.'),
  }),
  outputSchema: z.object({ id: z.number(), state: z.string() }),
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.pulls.createReview', (o) =>
      o.rest.pulls.createReview({
        owner,
        repo,
        pull_number: args.pullNumber,
        event: args.event,
        ...(args.body !== undefined ? { body: args.body } : {}),
      }),
    );
    return { id: data.id, state: data.state };
  },
});

const prs_request_reviewers = defineTool({
  name: 'prs_request_reviewers',
  namespace: NS,
  description: 'Request reviews from users or teams on a pull request.',
  inputSchema: z.object({
    ...repoTarget,
    pullNumber,
    reviewers: z.array(z.string()).optional(),
    teamReviewers: z.array(z.string()).optional(),
  }),
  outputSchema: z.object({ requested: z.array(z.string()) }),
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.pulls.requestReviewers', (o) =>
      o.rest.pulls.requestReviewers({
        owner,
        repo,
        pull_number: args.pullNumber,
        ...(args.reviewers ? { reviewers: args.reviewers } : {}),
        ...(args.teamReviewers ? { team_reviewers: args.teamReviewers } : {}),
      }),
    );
    const requested = (data.requested_reviewers ?? []).map((r) => r.login);
    return { requested };
  },
});

const prs_merge = defineTool({
  name: 'prs_merge',
  namespace: NS,
  description: 'Merge a pull request using merge, squash, or rebase.',
  inputSchema: z.object({
    ...repoTarget,
    pullNumber,
    method: z.enum(['merge', 'squash', 'rebase']).optional(),
    commitTitle: z.string().optional(),
  }),
  outputSchema: z.object({ merged: z.boolean(), sha: z.string().nullable(), message: z.string() }),
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.pulls.merge', (o) =>
      o.rest.pulls.merge({
        owner,
        repo,
        pull_number: args.pullNumber,
        ...(args.method ? { merge_method: args.method } : {}),
        ...(args.commitTitle ? { commit_title: args.commitTitle } : {}),
      }),
    );
    return { merged: data.merged, sha: data.sha ?? null, message: data.message };
  },
});

const prs_list_comments = defineTool({
  name: 'prs_list_comments',
  namespace: NS,
  description: 'List the review (inline diff) comments on a pull request.',
  inputSchema: z.object({ ...repoTarget, pullNumber, ...pagination }),
  outputSchema: z.object({ count: z.number(), items: z.array(commentSummary) }),
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.pulls.listReviewComments', (o) =>
      o.rest.pulls.listReviewComments({
        owner,
        repo,
        pull_number: args.pullNumber,
        ...(args.perPage ? { per_page: args.perPage } : {}),
        ...(args.page ? { page: args.page } : {}),
      }),
    );
    const items = data.map(mapComment);
    return { count: items.length, items };
  },
});

const prs_create_comment = defineTool({
  name: 'prs_create_comment',
  namespace: NS,
  description: 'Add an inline review comment on a specific file and line of a PR diff.',
  inputSchema: z.object({
    ...repoTarget,
    pullNumber,
    body: z.string().min(1),
    commitId: z.string().min(1).describe('SHA of the commit to comment on.'),
    path: z.string().min(1).describe('File path within the diff.'),
    line: z.number().int().positive().describe('Line in the file (right side of the diff).'),
    side: z.enum(['LEFT', 'RIGHT']).optional(),
  }),
  outputSchema: commentSummary,
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.pulls.createReviewComment', (o) =>
      o.rest.pulls.createReviewComment({
        owner,
        repo,
        pull_number: args.pullNumber,
        body: args.body,
        commit_id: args.commitId,
        path: args.path,
        line: args.line,
        ...(args.side ? { side: args.side } : {}),
      }),
    );
    return mapComment(data);
  },
});

const prs_get_mergeability = defineTool({
  name: 'prs_get_mergeability',
  namespace: NS,
  description: 'Check whether a pull request is currently mergeable and its merge state.',
  inputSchema: z.object({ ...repoTarget, pullNumber }),
  outputSchema: z.object({
    merged: z.boolean(),
    mergeable: z.boolean().nullable(),
    mergeableState: z.string().nullable(),
  }),
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.pulls.getMergeability', (o) =>
      o.rest.pulls.get({ owner, repo, pull_number: args.pullNumber }),
    );
    return {
      merged: Boolean(data.merged),
      mergeable: data.mergeable ?? null,
      mergeableState: data.mergeable_state ?? null,
    };
  },
});

export const prTools: AnyToolDefinition[] = [
  prs_list,
  prs_get,
  prs_get_diff,
  prs_list_files,
  prs_list_commits,
  prs_list_reviews,
  prs_create_review,
  prs_request_reviewers,
  prs_merge,
  prs_list_comments,
  prs_create_comment,
  prs_get_mergeability,
];
