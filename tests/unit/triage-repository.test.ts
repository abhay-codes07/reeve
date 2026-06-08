/**
 * Unit tests for the long-horizon triage_repository task. Fully MOCKED and
 * network-hermetic: the tool dispatcher and the investigate_issue subagent are
 * injected, so NO GitHub and NO Gemini calls happen. Asserts the plan is
 * persisted, compaction occurs, the tool-call counter crosses 20 on a simulated
 * 10-issue run, and the backlog shape is valid.
 */

import { describe, expect, it, vi } from 'vitest';
import { testContext } from '../helpers/context.js';
import {
  triageRepository,
  triageRepositoryResult,
  InMemoryTriageMemory,
} from '../../src/workflows/index.js';
import type { IssueInvestigation } from '../../src/agents/index.js';

const ctx = testContext();

// --- 10 simulated open issues ---------------------------------------------
function makeIssue(n: number, labels: string[] = []) {
  return {
    number: n,
    title: `Issue ${n}`,
    state: 'open',
    isPullRequest: false,
    author: 'alice',
    labels,
    assignees: [],
    commentCount: n % 3,
    createdAt: '2020-01-01T00:00:00Z',
    updatedAt: '2020-01-02T00:00:00Z',
    url: `https://github.com/x/${n}`,
  };
}
const ISSUES = Array.from({ length: 10 }, (_, i) => makeIssue(i + 1, i < 5 ? ['bug'] : []));

function makeClusterSet(items: ReturnType<typeof makeIssue>[]) {
  const bug = items.filter((i) => i.labels.includes('bug'));
  const other = items.filter((i) => !i.labels.includes('bug'));
  return {
    totalIssues: items.length,
    clusterCount: 2,
    clusters: [
      {
        key: 'bug',
        category: 'Bug',
        priority: 'high',
        score: 80,
        issueNumbers: bug.map((i) => i.number),
        issues: bug,
        rationale: 'bugs',
      },
      {
        key: 'uncategorized',
        category: 'Uncategorized',
        priority: 'low',
        score: 25,
        issueNumbers: other.map((i) => i.number),
        issues: other,
        rationale: 'misc',
      },
    ],
  };
}

/** A mock tool dispatcher mirroring the real tool output shapes. */
function makeInvoke() {
  return vi.fn(async (name: string, args: any) => {
    switch (name) {
      case 'issues_list': {
        const { perPage, page } = args as { perPage: number; page: number };
        const start = (page - 1) * perPage;
        const items = ISSUES.slice(start, start + perPage);
        return { count: items.length, items };
      }
      case 'cluster_issues':
        return makeClusterSet((args as { items: ReturnType<typeof makeIssue>[] }).items);
      case 'issues_get':
        return { number: (args as any).issueNumber };
      case 'issues_list_comments':
        return { count: 0, items: [] };
      case 'issues_list_events':
        return { count: 0, items: [] };
      case 'draft_triage_report': {
        const cs = args as ReturnType<typeof makeClusterSet>;
        return {
          generatedFrom: { clusterCount: cs.clusterCount, issueCount: cs.totalIssues },
          summary: 'mock report',
          backlog: cs.clusters.map((c, i) => ({
            rank: i + 1,
            clusterKey: c.key,
            category: c.category,
            priority: c.priority,
            issueNumbers: c.issueNumbers,
            suggestedLabels: ['needs-triage'],
            draftResponse: `Drafted response for ${c.category}.`,
          })),
        };
      }
      default:
        throw new Error(`unexpected tool ${name}`);
    }
  });
}

function makeInvestigate() {
  return vi.fn(
    async (issueNumber: number): Promise<IssueInvestigation> => ({
      issueNumber,
      summary: `Investigation of issue ${issueNumber}. `.repeat(20), // long -> must be compacted
      category: 'bug',
      severity: 'high',
      likelyCauses: ['cause'],
      relevantFiles: ['src/x.ts'],
      suggestedNextSteps: ['step'],
      needsMoreInfo: false,
    }),
  );
}

describe('triage_repository (mocked, hermetic)', () => {
  it('persists the plan, compacts batches, crosses 20 tool calls, valid backlog', async () => {
    const memory = new InMemoryTriageMemory();
    const invoke = makeInvoke();
    const investigate = makeInvestigate();

    const result = await triageRepository(ctx, { memory, invoke, investigate });

    // (1) PLAN persisted to memory with the five steps.
    const plan = memory.getPlan();
    expect(plan).toBeDefined();
    expect(plan!.steps).toHaveLength(5);
    expect(plan!.goal).toContain(`${ctx.env.sandbox.owner}/${ctx.env.sandbox.repo}`);
    expect(result.plan).toEqual(plan);

    // (2) COMPACTION: per-batch summaries recorded; investigations compacted.
    expect(memory.getBatchSummaries().length).toBeGreaterThan(0);
    expect(result.batchSummaries.length).toBe(memory.getBatchSummaries().length);
    // pages + cluster + investigations all produced summary lines.
    expect(result.batchSummaries.some((s) => s.startsWith('page 1'))).toBe(true);
    expect(result.batchSummaries.some((s) => s.startsWith('clustered'))).toBe(true);
    expect(result.batchSummaries.some((s) => s.startsWith('investigated'))).toBe(true);
    // Each investigation is the compact 4-field record, not the full object.
    for (const inv of result.investigations) {
      expect(Object.keys(inv).sort()).toEqual(['category', 'issueNumber', 'severity', 'summary']);
      expect(inv.summary.length).toBeLessThanOrEqual(240);
    }

    // (3) TOOL-CALL COUNTER crosses 20.
    expect(result.totalToolCalls).toBeGreaterThan(20);

    // (4) BACKLOG shape is valid.
    expect(triageRepositoryResult.safeParse(result).success).toBe(true);
    expect(result.backlog.length).toBeGreaterThan(0);
    for (const item of result.backlog) {
      expect(typeof item.rank).toBe('number');
      expect(item.draftResponse.length).toBeGreaterThan(0);
      expect(item.suggestedLabels.length).toBeGreaterThan(0);
    }
  });

  it('paginates through all issues with multiple list calls and a bounded subagent count', async () => {
    const invoke = makeInvoke();
    const investigate = makeInvestigate();

    const result = await triageRepository(ctx, {
      invoke,
      investigate,
      pageSize: 3,
      investigateLimit: 3,
    });

    const listCalls = invoke.mock.calls.filter(([name]) => name === 'issues_list').length;
    expect(listCalls).toBeGreaterThanOrEqual(2); // 10 issues / pageSize 3 -> multiple pages
    expect(investigate).toHaveBeenCalledTimes(3); // only the top items hit the subagent
    expect(result.totalIssues).toBe(10);
    expect(result.clusterCount).toBe(2);
  });

  it('respects investigateLimit (fewer subagent calls => still many tool calls)', async () => {
    const invoke = makeInvoke();
    const investigate = makeInvestigate();

    const result = await triageRepository(ctx, { invoke, investigate, investigateLimit: 1 });
    expect(investigate).toHaveBeenCalledTimes(1);
    // Pagination + context gathering for the top issues still pushes well past 20.
    expect(result.totalToolCalls).toBeGreaterThan(20);
  });
});
