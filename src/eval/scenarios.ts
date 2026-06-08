/**
 * Scored eval scenarios against fixtures that mirror the seeded sandbox issues.
 *
 * Every scenario's `produce()` runs OFFLINE: the deterministic triage transforms
 * (cluster_issues, draft_triage_report) are pure functions over fixture data, and
 * the investigation scenario uses a representative fixture. The only place a live
 * model is reached is a JUDGE check — and only when the live judge is selected.
 */

import { registry, invokeTool, type ToolContext } from '../tools/index.js';
import type { ClusterSet, TriageReport } from '../tools/namespaces/triage.js';
import type { IssueInvestigation } from '../agents/index.js';
import type { Scenario } from './scorer.js';

// cluster_issues / draft_triage_report never touch GitHub or env, so an offline
// context with only a sandbox placeholder is sufficient.
const offlineCtx = {
  env: { sandbox: { owner: 'reeve', repo: 'sandbox' } },
} as unknown as ToolContext;

function issue(
  number: number,
  title: string,
  labels: string[],
  commentCount: number,
) {
  return {
    number,
    title,
    state: 'open',
    isPullRequest: false,
    author: 'reporter',
    labels,
    assignees: [],
    commentCount,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-02T00:00:00Z',
    url: `https://github.com/reeve/sandbox/issues/${number}`,
  };
}

/** Fixture issue set mirroring the seeded sandbox. */
const FIXTURE_ISSUES = [
  issue(1, 'App crashes on startup when config file is missing', ['bug'], 5),
  issue(3, 'Document the required environment variables in the README', ['documentation'], 1),
  issue(5, 'Security: API tokens are written to logs in plaintext', ['bug'], 3),
  issue(6, 'How do I configure the database connection pool size?', ['question'], 0),
  issue(8, 'Slow response when listing more than 1000 records', [], 2),
  issue(9, "Typo in CLI message: 'occured' should be 'occurred'", [], 0),
];

const issueSetInput = { totalCount: FIXTURE_ISSUES.length, items: FIXTURE_ISSUES };

/** Representative investigation outcome for the security issue. */
const SECURITY_INVESTIGATION: IssueInvestigation = {
  issueNumber: 5,
  summary:
    'API tokens are logged in plaintext: the Authorization header is serialized at info level, exposing live credentials to anyone with log access.',
  category: 'security',
  severity: 'high',
  likelyCauses: ['Request logging serializes headers without redaction'],
  relevantFiles: ['src/logging/request-logger.ts', 'src/observability/logger.ts'],
  suggestedNextSteps: [
    'Redact Authorization/token fields before logging',
    'Add a test asserting tokens never appear in logs',
  ],
  needsMoreInfo: false,
};

async function cluster(): Promise<ClusterSet> {
  return (await invokeTool(registry, 'cluster_issues', issueSetInput, offlineCtx)) as ClusterSet;
}
async function backlog(): Promise<TriageReport> {
  const clusters = await cluster();
  return (await invokeTool(registry, 'draft_triage_report', clusters, offlineCtx)) as TriageReport;
}

function clusterOf(cs: ClusterSet, issueNumber: number) {
  return cs.clusters.find((c) => c.issueNumbers.includes(issueNumber));
}
function rankOfKey(report: TriageReport, key: string): number {
  return report.backlog.find((b) => b.clusterKey === key)?.rank ?? Number.MAX_SAFE_INTEGER;
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'crash-bug-categorised',
    description: 'A crash bug is categorised as a high-severity bug',
    produce: cluster,
    checks: [
      {
        kind: 'deterministic',
        description: 'issue #1 lands in the "bug" cluster at high/critical priority',
        run: (actual) => {
          const c = clusterOf(actual as ClusterSet, 1);
          const pass = !!c && c.key === 'bug' && ['high', 'critical'].includes(c.priority);
          return { pass, detail: c ? `cluster=${c.key} priority=${c.priority}` : 'not clustered' };
        },
      },
    ],
  },
  {
    id: 'docs-categorised',
    description: 'A docs-gap issue is categorised as documentation',
    produce: cluster,
    checks: [
      {
        kind: 'deterministic',
        description: 'issue #3 is categorised as Documentation',
        run: (actual) => {
          const c = clusterOf(actual as ClusterSet, 3);
          const pass = !!c && c.category === 'Documentation';
          return { pass, detail: c ? `category=${c.category}` : 'not clustered' };
        },
      },
    ],
  },
  {
    id: 'security-outranks-cosmetic',
    description: 'A security issue ranks above a cosmetic typo in the backlog',
    produce: backlog,
    checks: [
      {
        kind: 'deterministic',
        description: 'security cluster outranks the docs/cosmetic cluster',
        run: (actual) => {
          const report = actual as TriageReport;
          const sec = rankOfKey(report, 'security');
          const docs = rankOfKey(report, 'docs');
          return { pass: sec < docs, detail: `security rank=${sec}, docs rank=${docs}` };
        },
      },
    ],
  },
  {
    id: 'investigation-actionable',
    description: 'An investigation surfaces relevant files and next steps',
    produce: () => SECURITY_INVESTIGATION,
    checks: [
      {
        kind: 'deterministic',
        description: 'relevant files and suggested next steps are non-empty',
        run: (actual) => {
          const inv = actual as IssueInvestigation;
          const pass = inv.relevantFiles.length > 0 && inv.suggestedNextSteps.length > 0;
          return {
            pass,
            detail: `files=${inv.relevantFiles.length} steps=${inv.suggestedNextSteps.length}`,
          };
        },
      },
      {
        kind: 'judge',
        description: 'investigation identifies a security/credential-logging problem with a remediation',
        criterion:
          'The investigation identifies a security or credential-logging problem AND proposes a concrete remediation such as redacting tokens before logging.',
        content: (actual) => JSON.stringify(actual),
      },
    ],
  },
  {
    id: 'draft-response-on-topic',
    description: 'The drafted maintainer response for the top cluster is on-topic and actionable',
    produce: backlog,
    checks: [
      {
        kind: 'judge',
        description: 'top backlog item has a polite, on-topic, actionable draft response',
        criterion:
          'The drafted maintainer response is polite, on-topic for the issue category, and gives or requests a concrete next step.',
        content: (actual) => {
          const report = actual as TriageReport;
          return report.backlog[0]?.draftResponse ?? '';
        },
      },
    ],
  },
];
