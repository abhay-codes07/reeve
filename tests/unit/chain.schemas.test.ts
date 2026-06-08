/**
 * Composable-chain schema-lineup tests.
 *
 * Asserts the core invariant: each step's output schema IS the next step's input
 * schema (output[n] satisfies input[n+1]), both by referential identity and by
 * pushing real data through every hop. No network — the two transforms are
 * deterministic, so this runs under the hermetic unit project.
 */

import { describe, expect, it } from 'vitest';
import { buildRegistry, invokeTool } from '../../src/tools/index.js';
import { assertChainSchemasAlign, TRIAGE_CHAIN_STEPS } from '../../src/workflows/index.js';
import { issueSet } from '../../src/tools/schemas.js';
import { clusterSet, triageReport } from '../../src/tools/namespaces/triage.js';
import { testContext } from '../helpers/context.js';

const registry = buildRegistry();
const ctx = testContext();

const sampleIssueSet = {
  totalCount: 3,
  items: [
    {
      number: 1,
      title: 'App crashes on startup',
      state: 'open',
      isPullRequest: false,
      author: 'alice',
      labels: ['bug'],
      assignees: [],
      commentCount: 5,
      createdAt: '2020-01-01T00:00:00Z',
      updatedAt: '2020-01-02T00:00:00Z',
      url: 'https://github.com/x/1',
    },
    {
      number: 2,
      title: 'Add dark mode',
      state: 'open',
      isPullRequest: false,
      author: 'bob',
      labels: ['enhancement'],
      assignees: [],
      commentCount: 1,
      createdAt: '2020-01-01T00:00:00Z',
      updatedAt: '2020-01-02T00:00:00Z',
      url: 'https://github.com/x/2',
    },
    {
      number: 3,
      title: 'Typo in README',
      state: 'open',
      isPullRequest: false,
      author: 'carol',
      labels: [],
      assignees: [],
      commentCount: 0,
      createdAt: '2020-01-01T00:00:00Z',
      updatedAt: '2020-01-02T00:00:00Z',
      url: 'https://github.com/x/3',
    },
  ],
};

describe('triage chain schema lineup', () => {
  it('names the three steps in order', () => {
    expect([...TRIAGE_CHAIN_STEPS]).toEqual([
      'search_issues',
      'cluster_issues',
      'draft_triage_report',
    ]);
  });

  it('each step output schema IS the next step input schema (referential)', () => {
    const hops = assertChainSchemasAlign();
    expect(hops).toEqual([
      { from: 'search_issues', to: 'cluster_issues', aligned: true },
      { from: 'cluster_issues', to: 'draft_triage_report', aligned: true },
    ]);

    const [search, cluster, draft] = TRIAGE_CHAIN_STEPS.map((n) => registry.get(n));
    expect(search!.outputSchema).toBe(cluster!.inputSchema);
    expect(search!.outputSchema).toBe(issueSet);
    expect(cluster!.outputSchema).toBe(draft!.inputSchema);
    expect(cluster!.outputSchema).toBe(clusterSet);
  });

  it('output[n] validates as input[n+1] when real data flows through', async () => {
    // Step1 shape (search output) parses as step2 input.
    expect(registry.get('cluster_issues').inputSchema.safeParse(sampleIssueSet).success).toBe(true);

    // Run step2; its output parses as step3 input.
    const clusters = (await invokeTool(registry, 'cluster_issues', sampleIssueSet, ctx)) as any;
    expect(registry.get('draft_triage_report').inputSchema.safeParse(clusters).success).toBe(true);

    // Run step3; output conforms to the report schema.
    const report = (await invokeTool(registry, 'draft_triage_report', clusters, ctx)) as any;
    expect(triageReport.safeParse(report).success).toBe(true);
  });

  it('clustering prioritises a bug above a docs typo and drafts responses', async () => {
    const clusters = (await invokeTool(registry, 'cluster_issues', sampleIssueSet, ctx)) as any;
    const report = (await invokeTool(registry, 'draft_triage_report', clusters, ctx)) as any;

    expect(report.backlog.length).toBe(clusters.clusterCount);
    expect(report.backlog[0].rank).toBe(1);
    // The bug cluster (weight 70 + engagement) should outrank docs (weight 30).
    const bugRank = report.backlog.find((b: any) => b.clusterKey === 'bug').rank;
    const docsRank = report.backlog.find((b: any) => b.clusterKey === 'docs').rank;
    expect(bugRank).toBeLessThan(docsRank);
    for (const item of report.backlog) {
      expect(item.draftResponse.length).toBeGreaterThan(0);
      expect(item.suggestedLabels.length).toBeGreaterThan(0);
    }
  });
});
