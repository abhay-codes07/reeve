/**
 * `github-actions` namespace — observe and control GitHub Actions.
 */

import { z } from 'zod';
import { defineTool, type AnyToolDefinition } from '../types.js';
import { resolveRepo } from '../context.js';
import { repoTarget, pagination } from '../schemas.js';

const NS = 'github-actions' as const;
const runId = z.number().int().positive().describe('The workflow run id.');

const workflowSummary = z.object({
  id: z.number(),
  name: z.string(),
  path: z.string(),
  state: z.string(),
});

const runSummary = z.object({
  id: z.number(),
  name: z.string().nullable(),
  status: z.string().nullable(),
  conclusion: z.string().nullable(),
  headBranch: z.string().nullable(),
  event: z.string(),
  runNumber: z.number(),
  createdAt: z.string(),
  url: z.string(),
});

function mapRun(r: Record<string, any>): z.infer<typeof runSummary> {
  return {
    id: r.id,
    name: r.name ?? null,
    status: r.status ?? null,
    conclusion: r.conclusion ?? null,
    headBranch: r.head_branch ?? null,
    event: r.event,
    runNumber: r.run_number,
    createdAt: r.created_at,
    url: r.html_url,
  };
}

const actions_list_workflows = defineTool({
  name: 'actions_list_workflows',
  namespace: NS,
  description: 'List the GitHub Actions workflows defined in the repository.',
  inputSchema: z.object({ ...repoTarget, ...pagination }),
  outputSchema: z.object({ count: z.number(), items: z.array(workflowSummary) }),
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.actions.listRepoWorkflows', (o) =>
      o.rest.actions.listRepoWorkflows({
        owner,
        repo,
        ...(args.perPage ? { per_page: args.perPage } : {}),
        ...(args.page ? { page: args.page } : {}),
      }),
    );
    const items = data.workflows.map((w) => ({
      id: w.id,
      name: w.name,
      path: w.path,
      state: w.state,
    }));
    return { count: items.length, items };
  },
});

const actions_get_workflow = defineTool({
  name: 'actions_get_workflow',
  namespace: NS,
  description: 'Get a single workflow by id or filename.',
  inputSchema: z.object({
    ...repoTarget,
    workflowId: z.union([z.number(), z.string()]).describe('Workflow id or filename (e.g. ci.yml).'),
  }),
  outputSchema: workflowSummary,
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.actions.getWorkflow', (o) =>
      o.rest.actions.getWorkflow({ owner, repo, workflow_id: args.workflowId }),
    );
    return { id: data.id, name: data.name, path: data.path, state: data.state };
  },
});

const actions_list_runs = defineTool({
  name: 'actions_list_runs',
  namespace: NS,
  description: 'List workflow runs for the repository, filterable by branch, status, or event.',
  inputSchema: z.object({
    ...repoTarget,
    branch: z.string().optional(),
    event: z.string().optional(),
    status: z
      .enum(['queued', 'in_progress', 'completed', 'success', 'failure', 'cancelled'])
      .optional(),
    ...pagination,
  }),
  outputSchema: z.object({ totalCount: z.number(), items: z.array(runSummary) }),
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.actions.listWorkflowRunsForRepo', (o) =>
      o.rest.actions.listWorkflowRunsForRepo({
        owner,
        repo,
        ...(args.branch ? { branch: args.branch } : {}),
        ...(args.event ? { event: args.event } : {}),
        ...(args.status ? { status: args.status } : {}),
        ...(args.perPage ? { per_page: args.perPage } : {}),
        ...(args.page ? { page: args.page } : {}),
      }),
    );
    return { totalCount: data.total_count, items: data.workflow_runs.map(mapRun) };
  },
});

const actions_get_run = defineTool({
  name: 'actions_get_run',
  namespace: NS,
  description: 'Get a single workflow run with its status and conclusion.',
  inputSchema: z.object({ ...repoTarget, runId }),
  outputSchema: runSummary,
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.actions.getWorkflowRun', (o) =>
      o.rest.actions.getWorkflowRun({ owner, repo, run_id: args.runId }),
    );
    return mapRun(data);
  },
});

const actions_list_run_jobs = defineTool({
  name: 'actions_list_run_jobs',
  namespace: NS,
  description: 'List the jobs of a workflow run with their status and conclusion.',
  inputSchema: z.object({ ...repoTarget, runId, ...pagination }),
  outputSchema: z.object({
    totalCount: z.number(),
    items: z.array(
      z.object({
        id: z.number(),
        name: z.string(),
        status: z.string().nullable(),
        conclusion: z.string().nullable(),
      }),
    ),
  }),
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.actions.listJobsForWorkflowRun', (o) =>
      o.rest.actions.listJobsForWorkflowRun({
        owner,
        repo,
        run_id: args.runId,
        ...(args.perPage ? { per_page: args.perPage } : {}),
        ...(args.page ? { page: args.page } : {}),
      }),
    );
    const items = data.jobs.map((j) => ({
      id: j.id,
      name: j.name,
      status: j.status ?? null,
      conclusion: j.conclusion ?? null,
    }));
    return { totalCount: data.total_count, items };
  },
});

const actions_get_run_logs_url = defineTool({
  name: 'actions_get_run_logs_url',
  namespace: NS,
  description: 'Get the download URL for a workflow run\'s logs archive.',
  inputSchema: z.object({ ...repoTarget, runId }),
  outputSchema: z.object({ runId: z.number(), url: z.string() }),
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const res = await ctx.github.request('github.actions.downloadWorkflowRunLogs', (o) =>
      o.rest.actions.downloadWorkflowRunLogs({ owner, repo, run_id: args.runId }),
    );
    // GitHub answers with a redirect to a signed URL; Octokit surfaces it as the
    // resolved response URL.
    return { runId: args.runId, url: res.url };
  },
});

const actions_rerun_workflow = defineTool({
  name: 'actions_rerun_workflow',
  namespace: NS,
  description: 'Re-run all jobs of a workflow run.',
  inputSchema: z.object({ ...repoTarget, runId }),
  outputSchema: z.object({ rerunRequested: z.boolean() }),
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    await ctx.github.request('github.actions.reRunWorkflow', (o) =>
      o.rest.actions.reRunWorkflow({ owner, repo, run_id: args.runId }),
    );
    return { rerunRequested: true };
  },
});

const actions_cancel_run = defineTool({
  name: 'actions_cancel_run',
  namespace: NS,
  description: 'Cancel an in-progress workflow run.',
  inputSchema: z.object({ ...repoTarget, runId }),
  outputSchema: z.object({ cancelRequested: z.boolean() }),
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    await ctx.github.request('github.actions.cancelWorkflowRun', (o) =>
      o.rest.actions.cancelWorkflowRun({ owner, repo, run_id: args.runId }),
    );
    return { cancelRequested: true };
  },
});

export const actionTools: AnyToolDefinition[] = [
  actions_list_workflows,
  actions_get_workflow,
  actions_list_runs,
  actions_get_run,
  actions_list_run_jobs,
  actions_get_run_logs_url,
  actions_rerun_workflow,
  actions_cancel_run,
];
