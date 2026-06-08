/**
 * `github-issues` namespace — read and manage issues.
 */

import { z } from 'zod';
import { defineTool, type AnyToolDefinition } from '../types.js';
import { resolveRepo } from '../context.js';
import {
  repoTarget,
  pagination,
  issueSummary,
  issueDetail,
  commentSummary,
  mapIssueSummary,
  mapIssueDetail,
  mapComment,
} from '../schemas.js';

const NS = 'github-issues' as const;

const issueNumber = z.number().int().positive().describe('The issue number.');

const issues_list = defineTool({
  name: 'issues_list',
  namespace: NS,
  description: 'List issues in a repository, filterable by state, labels, and assignee.',
  inputSchema: z.object({
    ...repoTarget,
    state: z.enum(['open', 'closed', 'all']).optional(),
    labels: z.array(z.string()).optional().describe('Only issues with all of these labels.'),
    assignee: z.string().optional(),
    sort: z.enum(['created', 'updated', 'comments']).optional(),
    direction: z.enum(['asc', 'desc']).optional(),
    ...pagination,
  }),
  outputSchema: z.object({ count: z.number(), items: z.array(issueSummary) }),
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.issues.listForRepo', (o) =>
      o.rest.issues.listForRepo({
        owner,
        repo,
        ...(args.state ? { state: args.state } : {}),
        ...(args.labels ? { labels: args.labels.join(',') } : {}),
        ...(args.assignee ? { assignee: args.assignee } : {}),
        ...(args.sort ? { sort: args.sort } : {}),
        ...(args.direction ? { direction: args.direction } : {}),
        ...(args.perPage ? { per_page: args.perPage } : {}),
        ...(args.page ? { page: args.page } : {}),
      }),
    );
    const items = data.map(mapIssueSummary);
    return { count: items.length, items };
  },
});

const issues_get = defineTool({
  name: 'issues_get',
  namespace: NS,
  description: 'Get a single issue with its full body and metadata.',
  inputSchema: z.object({ ...repoTarget, issueNumber }),
  outputSchema: issueDetail,
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.issues.get', (o) =>
      o.rest.issues.get({ owner, repo, issue_number: args.issueNumber }),
    );
    return mapIssueDetail(data);
  },
});

const issues_create = defineTool({
  name: 'issues_create',
  namespace: NS,
  description: 'Open a new issue with a title, optional body, labels, and assignees.',
  inputSchema: z.object({
    ...repoTarget,
    title: z.string().min(1),
    body: z.string().optional(),
    labels: z.array(z.string()).optional(),
    assignees: z.array(z.string()).optional(),
  }),
  outputSchema: issueDetail,
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.issues.create', (o) =>
      o.rest.issues.create({
        owner,
        repo,
        title: args.title,
        ...(args.body !== undefined ? { body: args.body } : {}),
        ...(args.labels ? { labels: args.labels } : {}),
        ...(args.assignees ? { assignees: args.assignees } : {}),
      }),
    );
    return mapIssueDetail(data);
  },
});

const issues_update = defineTool({
  name: 'issues_update',
  namespace: NS,
  description: 'Edit an issue\'s title, body, labels, assignees, or milestone.',
  inputSchema: z.object({
    ...repoTarget,
    issueNumber,
    title: z.string().optional(),
    body: z.string().optional(),
    labels: z.array(z.string()).optional(),
    assignees: z.array(z.string()).optional(),
  }),
  outputSchema: issueDetail,
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.issues.update', (o) =>
      o.rest.issues.update({
        owner,
        repo,
        issue_number: args.issueNumber,
        ...(args.title !== undefined ? { title: args.title } : {}),
        ...(args.body !== undefined ? { body: args.body } : {}),
        ...(args.labels ? { labels: args.labels } : {}),
        ...(args.assignees ? { assignees: args.assignees } : {}),
      }),
    );
    return mapIssueDetail(data);
  },
});

const issues_comment = defineTool({
  name: 'issues_comment',
  namespace: NS,
  description: 'Post a comment on an issue or pull request.',
  inputSchema: z.object({ ...repoTarget, issueNumber, body: z.string().min(1) }),
  outputSchema: commentSummary,
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.issues.createComment', (o) =>
      o.rest.issues.createComment({ owner, repo, issue_number: args.issueNumber, body: args.body }),
    );
    return mapComment(data);
  },
});

const issues_list_comments = defineTool({
  name: 'issues_list_comments',
  namespace: NS,
  description: 'List the comments on an issue or pull request.',
  inputSchema: z.object({ ...repoTarget, issueNumber, ...pagination }),
  outputSchema: z.object({ count: z.number(), items: z.array(commentSummary) }),
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.issues.listComments', (o) =>
      o.rest.issues.listComments({
        owner,
        repo,
        issue_number: args.issueNumber,
        ...(args.perPage ? { per_page: args.perPage } : {}),
        ...(args.page ? { page: args.page } : {}),
      }),
    );
    const items = data.map(mapComment);
    return { count: items.length, items };
  },
});

const issues_add_labels = defineTool({
  name: 'issues_add_labels',
  namespace: NS,
  description: 'Add one or more labels to an issue.',
  inputSchema: z.object({ ...repoTarget, issueNumber, labels: z.array(z.string()).min(1) }),
  outputSchema: z.object({ labels: z.array(z.string()) }),
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.issues.addLabels', (o) =>
      o.rest.issues.addLabels({ owner, repo, issue_number: args.issueNumber, labels: args.labels }),
    );
    return { labels: data.map((l) => l.name) };
  },
});

const issues_remove_label = defineTool({
  name: 'issues_remove_label',
  namespace: NS,
  description: 'Remove a single label from an issue.',
  inputSchema: z.object({ ...repoTarget, issueNumber, name: z.string().min(1) }),
  outputSchema: z.object({ labels: z.array(z.string()) }),
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.issues.removeLabel', (o) =>
      o.rest.issues.removeLabel({ owner, repo, issue_number: args.issueNumber, name: args.name }),
    );
    return { labels: data.map((l) => l.name) };
  },
});

const issues_set_assignees = defineTool({
  name: 'issues_set_assignees',
  namespace: NS,
  description: 'Add assignees to an issue.',
  inputSchema: z.object({ ...repoTarget, issueNumber, assignees: z.array(z.string()).min(1) }),
  outputSchema: z.object({ assignees: z.array(z.string()) }),
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.issues.addAssignees', (o) =>
      o.rest.issues.addAssignees({
        owner,
        repo,
        issue_number: args.issueNumber,
        assignees: args.assignees,
      }),
    );
    return { assignees: (data.assignees ?? []).map((a) => a.login) };
  },
});

const issues_close = defineTool({
  name: 'issues_close',
  namespace: NS,
  description: 'Close an issue, optionally as completed or not_planned.',
  inputSchema: z.object({
    ...repoTarget,
    issueNumber,
    reason: z.enum(['completed', 'not_planned']).optional(),
  }),
  outputSchema: issueDetail,
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.issues.close', (o) =>
      o.rest.issues.update({
        owner,
        repo,
        issue_number: args.issueNumber,
        state: 'closed',
        ...(args.reason ? { state_reason: args.reason } : {}),
      }),
    );
    return mapIssueDetail(data);
  },
});

const issues_reopen = defineTool({
  name: 'issues_reopen',
  namespace: NS,
  description: 'Reopen a closed issue.',
  inputSchema: z.object({ ...repoTarget, issueNumber }),
  outputSchema: issueDetail,
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.issues.reopen', (o) =>
      o.rest.issues.update({ owner, repo, issue_number: args.issueNumber, state: 'open' }),
    );
    return mapIssueDetail(data);
  },
});

const issues_lock = defineTool({
  name: 'issues_lock',
  namespace: NS,
  description: 'Lock an issue conversation, with an optional reason.',
  inputSchema: z.object({
    ...repoTarget,
    issueNumber,
    reason: z.enum(['off-topic', 'too heated', 'resolved', 'spam']).optional(),
  }),
  outputSchema: z.object({ locked: z.boolean() }),
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    await ctx.github.request('github.issues.lock', (o) =>
      o.rest.issues.lock({
        owner,
        repo,
        issue_number: args.issueNumber,
        ...(args.reason ? { lock_reason: args.reason } : {}),
      }),
    );
    return { locked: true };
  },
});

const issues_list_events = defineTool({
  name: 'issues_list_events',
  namespace: NS,
  description: 'List the timeline events (labeled, assigned, closed, …) of an issue.',
  inputSchema: z.object({ ...repoTarget, issueNumber, ...pagination }),
  outputSchema: z.object({
    count: z.number(),
    items: z.array(
      z.object({
        event: z.string(),
        actor: z.string().nullable(),
        createdAt: z.string().nullable(),
      }),
    ),
  }),
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.issues.listEvents', (o) =>
      o.rest.issues.listEvents({
        owner,
        repo,
        issue_number: args.issueNumber,
        ...(args.perPage ? { per_page: args.perPage } : {}),
        ...(args.page ? { page: args.page } : {}),
      }),
    );
    const items = data.map((e) => ({
      event: e.event ?? 'unknown',
      actor: e.actor?.login ?? null,
      createdAt: e.created_at ?? null,
    }));
    return { count: items.length, items };
  },
});

const issues_search_in_repo = defineTool({
  name: 'issues_search_in_repo',
  namespace: NS,
  description: 'Search issues within this repository using a GitHub search query.',
  inputSchema: z.object({
    ...repoTarget,
    query: z.string().min(1).describe('Search terms; automatically scoped to the repo.'),
    ...pagination,
  }),
  outputSchema: z.object({ totalCount: z.number(), items: z.array(issueSummary) }),
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const q = `repo:${owner}/${repo} is:issue ${args.query}`.trim();
    const { data } = await ctx.github.request('github.search.issuesInRepo', (o) =>
      o.rest.search.issuesAndPullRequests({
        q,
        ...(args.perPage ? { per_page: args.perPage } : {}),
        ...(args.page ? { page: args.page } : {}),
      }),
    );
    return { totalCount: data.total_count, items: data.items.map(mapIssueSummary) };
  },
});

export const issueTools: AnyToolDefinition[] = [
  issues_list,
  issues_get,
  issues_create,
  issues_update,
  issues_comment,
  issues_list_comments,
  issues_add_labels,
  issues_remove_label,
  issues_set_assignees,
  issues_close,
  issues_reopen,
  issues_lock,
  issues_list_events,
  issues_search_in_repo,
];
