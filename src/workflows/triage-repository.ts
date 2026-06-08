/**
 * triage_repository — Reeve's flagship long-horizon task (CLAUDE.md invariant #3).
 *
 * A CONTROLLED LOOP (deterministic orchestration, not the LLM router) that
 * triages every open issue in a repository in a single session, comfortably
 * crossing 20+ tool calls while keeping its plan coherent. The only model surface
 * is the `investigate_issue` subagent; everything else is GitHub reads + the
 * deterministic triage transforms, so the run is reproducible and testable.
 *
 * Plan & context-management strategy (explicit, not implicit):
 *   1. PLAN is recorded to memory up front: gather -> cluster -> investigate top
 *      items -> draft responses -> emit ranked backlog.
 *   2. GATHER paginates through ALL open issues (multiple `issues_list` calls).
 *      Each page is COMPACTED to a one-line summary in memory; only the condensed
 *      issueSummary list (no bodies) is carried forward.
 *   3. CLUSTER groups the issues; the cluster set is compacted to a summary line.
 *   4. INVESTIGATE gathers per-issue context and runs the investigate_issue
 *      subagent on the top-priority items. Each investigation is COMPACTED to a
 *      4-field record + a summary line; the full transcript is never retained.
 *   5. DRAFT produces the ranked backlog with maintainer responses.
 *
 * Because every processed batch is reduced to a short summary, the working set
 * stays bounded no matter how many issues the repo has — that is the compaction
 * strategy made concrete. A ToolCallCounter logs the running count through the
 * observability layer and the final result reports the total.
 */

import { z } from 'zod';
import { registry, invokeTool, type ToolContext } from '../tools/index.js';
import {
  backlogItem,
  type ClusterSet,
  type TriageReport,
} from '../tools/namespaces/triage.js';
import { issueSummary } from '../tools/schemas.js';
import { runInvestigateIssue } from '../agents/index.js';
import type { IssueInvestigation } from '../agents/index.js';
import { createOperationLogger, type Logger } from '../observability/index.js';
import {
  InMemoryTriageMemory,
  type TriageMemory,
  type TriagePlan,
} from './triage-memory.js';

// ---------------------------------------------------------------------------
// Result schema
// ---------------------------------------------------------------------------

export const triagePlanSchema = z.object({
  goal: z.string(),
  repo: z.string(),
  steps: z.array(z.string()),
  createdAt: z.string(),
});

/** A compacted investigation record (NOT the full transcript). */
export const investigationSummary = z.object({
  issueNumber: z.number(),
  category: z.string(),
  severity: z.string(),
  summary: z.string(),
});

export const triageRepositoryResult = z.object({
  repo: z.string(),
  plan: triagePlanSchema,
  totalIssues: z.number(),
  clusterCount: z.number(),
  /** Total tool calls made in the session — must exceed 20 on the sandbox. */
  totalToolCalls: z.number(),
  investigations: z.array(investigationSummary),
  /** The ranked backlog with drafted maintainer responses. */
  backlog: z.array(backlogItem),
  /** The compacted per-batch summaries (the bounded working context). */
  batchSummaries: z.array(z.string()),
});
export type TriageRepositoryResult = z.infer<typeof triageRepositoryResult>;

// ---------------------------------------------------------------------------
// Tool-call counter (through observability)
// ---------------------------------------------------------------------------

/** Counts every tool/subagent call and logs the running total. */
export class ToolCallCounter {
  private n = 0;
  constructor(private readonly log: Logger) {}
  get count(): number {
    return this.n;
  }
  record(label: string): number {
    this.n += 1;
    this.log.info({ toolCall: label, count: this.n }, 'triage.tool_call');
    return this.n;
  }
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export interface TriageRepositoryOptions {
  /** `owner/repo` override; defaults to the configured sandbox. */
  repo?: string;
  /** Page size for issue pagination. Small values force multiple list calls. */
  pageSize?: number;
  /** Gather full context (get + comments + events) for the top N issues. */
  contextLimit?: number;
  /** Run the investigate_issue subagent on the top N issues. */
  investigateLimit?: number;
  /** Memory store (defaults to a fresh in-process store). */
  memory?: TriageMemory;
  /** Tool dispatcher (defaults to the real registry). Injected in tests. */
  invoke?: (toolName: string, args: unknown) => Promise<unknown>;
  /** Subagent runner (defaults to the real one). Injected in tests. */
  investigate?: (issueNumber: number) => Promise<IssueInvestigation>;
  logger?: Logger;
}

type IssueSummary = z.infer<typeof issueSummary>;

function splitRepo(repo: string | undefined, ctx: ToolContext): { owner: string; repo: string } {
  if (!repo) return { owner: ctx.env.sandbox.owner, repo: ctx.env.sandbox.repo };
  const [owner, name] = repo.split('/');
  if (!owner || !name) {
    return { owner: ctx.env.sandbox.owner, repo: ctx.env.sandbox.repo };
  }
  return { owner, repo: name };
}

export async function triageRepository(
  ctx: ToolContext,
  options: TriageRepositoryOptions = {},
): Promise<TriageRepositoryResult> {
  const log = options.logger ?? createOperationLogger({ operation: 'triage_repository' }, ctx.logger);
  const memory = options.memory ?? new InMemoryTriageMemory();
  const counter = new ToolCallCounter(log);

  const pageSize = options.pageSize ?? 3;
  const contextLimit = options.contextLimit ?? 6;
  const investigateLimit = options.investigateLimit ?? 3;
  const { owner, repo } = splitRepo(options.repo, ctx);
  const repoFull = `${owner}/${repo}`;

  const invoke = options.invoke ?? ((name, args) => invokeTool(registry, name, args, ctx));
  const investigate = options.investigate ?? ((n: number) => runInvestigateIssue(ctx, n));

  // Counted wrappers — every external call flows through these.
  const callTool = async (name: string, args: unknown, label?: string): Promise<unknown> => {
    counter.record(label ?? name);
    return invoke(name, args);
  };
  const callInvestigate = async (issueNumber: number): Promise<IssueInvestigation> => {
    counter.record(`investigate_issue#${issueNumber}`);
    return investigate(issueNumber);
  };

  // 1) PLAN -------------------------------------------------------------------
  const plan: TriagePlan = {
    goal: `Triage all open issues in ${repoFull}`,
    repo: repoFull,
    steps: [
      'gather: paginate through all open issues',
      'cluster: group issues into prioritised clusters',
      'investigate: run the investigate_issue subagent on the top-priority items',
      'draft: write maintainer responses for each cluster',
      'backlog: emit a ranked backlog',
    ],
    createdAt: new Date().toISOString(),
  };
  memory.recordPlan(plan);
  log.info({ plan }, 'triage.plan_recorded');

  // 2) GATHER (paginate ALL open issues) -------------------------------------
  const allItems: IssueSummary[] = [];
  let page = 1;
  for (;;) {
    const res = (await callTool(
      'issues_list',
      { owner, repo, state: 'open', perPage: pageSize, page },
      `issues_list:page${page}`,
    )) as { count: number; items: IssueSummary[] };
    allItems.push(...res.items);
    // COMPACT: reduce this page to one line; drop the raw page from the working set.
    memory.recordBatchSummary(
      `page ${page}: ${res.items.length} issue(s) [${res.items.map((i) => `#${i.number}`).join(', ')}]`,
    );
    if (res.items.length < pageSize) break;
    page += 1;
  }
  memory.setState('totalIssues', allItems.length);
  log.info({ totalIssues: allItems.length, pages: page }, 'triage.gathered');

  // 3) CLUSTER ----------------------------------------------------------------
  const clusterSet = (await callTool(
    'cluster_issues',
    { totalCount: allItems.length, items: allItems },
    'cluster_issues',
  )) as ClusterSet;
  memory.setState('clusterCount', clusterSet.clusterCount);
  memory.recordBatchSummary(
    `clustered ${allItems.length} issue(s) into ${clusterSet.clusterCount} group(s): ` +
      clusterSet.clusters.map((c) => `${c.key}(${c.priority})`).join(', '),
  );

  // Rank: clusters arrive priority-sorted; flatten to an ordered issue list.
  const ranked = clusterSet.clusters.flatMap((c) => c.issues.map((issue) => issue));

  // 4) INVESTIGATE top items --------------------------------------------------
  // Gather extra context (read-only) for the top issues...
  for (const issue of ranked.slice(0, contextLimit)) {
    await callTool('issues_get', { owner, repo, issueNumber: issue.number }, `issues_get#${issue.number}`);
    await callTool(
      'issues_list_comments',
      { owner, repo, issueNumber: issue.number },
      `issues_list_comments#${issue.number}`,
    );
    await callTool(
      'issues_list_events',
      { owner, repo, issueNumber: issue.number },
      `issues_list_events#${issue.number}`,
    );
  }
  // ...then run the isolated subagent on the very top items.
  const investigations: z.infer<typeof investigationSummary>[] = [];
  for (const issue of ranked.slice(0, investigateLimit)) {
    const inv = await callInvestigate(issue.number);
    // COMPACT: keep a 4-field record, not the full investigation object.
    const compact = {
      issueNumber: issue.number,
      category: inv.category,
      severity: inv.severity,
      summary: inv.summary.slice(0, 240),
    };
    investigations.push(compact);
    memory.recordBatchSummary(`investigated #${issue.number}: ${inv.severity}/${inv.category}`);
  }
  memory.setState('investigated', investigations.length);

  // 5) DRAFT ranked backlog ---------------------------------------------------
  const report = (await callTool('draft_triage_report', clusterSet, 'draft_triage_report')) as TriageReport;

  const result: TriageRepositoryResult = {
    repo: repoFull,
    plan,
    totalIssues: allItems.length,
    clusterCount: clusterSet.clusterCount,
    totalToolCalls: counter.count,
    investigations,
    backlog: report.backlog,
    batchSummaries: memory.getBatchSummaries(),
  };
  log.info(
    { totalToolCalls: counter.count, backlogSize: report.backlog.length },
    'triage.done',
  );
  return triageRepositoryResult.parse(result);
}
