/**
 * `triage` namespace — composable transforms over issue data.
 *
 * These two tools form the back half of the composable chain
 * `search_issues -> cluster_issues -> draft_triage_report`. They are
 * deterministic transforms (no network, no LLM) so the chain is reproducible and
 * cheaply testable; the model's judgement lives in the orchestrator that drives
 * the chain. The handoff schemas are shared BY REFERENCE so each step's output
 * schema is literally the next step's input schema:
 *
 *   search_issues.outputSchema === cluster_issues.inputSchema   (issueSet)
 *   cluster_issues.outputSchema === draft_triage_report.inputSchema (clusterSet)
 */

import { z } from 'zod';
import { defineTool, type AnyToolDefinition } from '../types.js';
import { issueSet, issueSummary } from '../schemas.js';

const NS = 'triage' as const;

/** Priority bands, highest first. */
export const PRIORITY = ['critical', 'high', 'medium', 'low'] as const;
export const prioritySchema = z.enum(PRIORITY);
export type Priority = (typeof PRIORITY)[number];

// ---------------------------------------------------------------------------
// cluster_issues
// ---------------------------------------------------------------------------

export const cluster = z.object({
  key: z.string().describe('Stable cluster id, e.g. "bug".'),
  category: z.string().describe('Human-readable category name.'),
  priority: prioritySchema,
  score: z.number().describe('Numeric priority score (higher = more urgent).'),
  issueNumbers: z.array(z.number()),
  issues: z.array(issueSummary),
  rationale: z.string().describe('Why these issues are grouped and ranked here.'),
});
export type Cluster = z.infer<typeof cluster>;

/** Output of cluster_issues / input of draft_triage_report (shared by reference). */
export const clusterSet = z.object({
  totalIssues: z.number(),
  clusterCount: z.number(),
  clusters: z.array(cluster),
});
export type ClusterSet = z.infer<typeof clusterSet>;

/** Category rules: label/keyword signals -> (key, name, base weight). */
const CATEGORY_RULES: Array<{
  key: string;
  category: string;
  weight: number;
  labels: string[];
  keywords: string[];
}> = [
  { key: 'security', category: 'Security', weight: 100, labels: ['security', 'vulnerability'], keywords: ['security', 'cve', 'exploit', 'vulnerab'] },
  { key: 'bug', category: 'Bug', weight: 70, labels: ['bug', 'defect', 'regression'], keywords: ['bug', 'broken', 'crash', 'error', 'fail', 'regression'] },
  { key: 'performance', category: 'Performance', weight: 55, labels: ['performance', 'perf'], keywords: ['slow', 'performance', 'latency', 'memory leak'] },
  { key: 'docs', category: 'Documentation', weight: 30, labels: ['documentation', 'docs'], keywords: ['docs', 'documentation', 'readme', 'typo'] },
  { key: 'feature', category: 'Feature request', weight: 40, labels: ['enhancement', 'feature'], keywords: ['feature', 'add support', 'would be nice', 'request'] },
  { key: 'question', category: 'Question / support', weight: 20, labels: ['question', 'support'], keywords: ['how do i', 'question', 'help'] },
];

const FALLBACK = { key: 'uncategorized', category: 'Uncategorized', weight: 25 };

function categorize(issue: z.infer<typeof issueSummary>): { key: string; category: string; weight: number } {
  const labels = issue.labels.map((l) => l.toLowerCase());
  const title = issue.title.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.labels.some((l) => labels.includes(l))) return rule;
    if (rule.keywords.some((k) => title.includes(k))) return rule;
  }
  return FALLBACK;
}

function priorityFor(score: number): Priority {
  if (score >= 90) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
}

const cluster_issues = defineTool({
  name: 'cluster_issues',
  namespace: NS,
  description:
    'Group a set of issues into prioritised, labelled clusters by category signals. Consumes search_issues output.',
  inputSchema: issueSet,
  outputSchema: clusterSet,
  handler: async (input) => {
    const groups = new Map<string, { category: string; weight: number; issues: z.infer<typeof issueSummary>[] }>();

    for (const issue of input.items) {
      const { key, category, weight } = categorize(issue);
      const group = groups.get(key) ?? { category, weight, issues: [] };
      group.issues.push(issue);
      groups.set(key, group);
    }

    const clusters: Cluster[] = [...groups.entries()].map(([key, g]) => {
      // Score blends category weight with volume and engagement signals.
      const volume = g.issues.length;
      const comments = g.issues.reduce((sum, i) => sum + i.commentCount, 0);
      const score = Math.round(g.weight + Math.min(volume * 3, 20) + Math.min(comments, 15));
      return {
        key,
        category: g.category,
        priority: priorityFor(score),
        score,
        issueNumbers: g.issues.map((i) => i.number),
        issues: g.issues,
        rationale: `${volume} issue(s) in ${g.category}; ${comments} total comment(s). Base weight ${g.weight}.`,
      };
    });

    clusters.sort((a, b) => b.score - a.score);

    return {
      totalIssues: input.items.length,
      clusterCount: clusters.length,
      clusters,
    };
  },
});

// ---------------------------------------------------------------------------
// draft_triage_report
// ---------------------------------------------------------------------------

export const backlogItem = z.object({
  rank: z.number(),
  clusterKey: z.string(),
  category: z.string(),
  priority: prioritySchema,
  issueNumbers: z.array(z.number()),
  suggestedLabels: z.array(z.string()),
  draftResponse: z.string().describe('A drafted maintainer response for these issues.'),
});

export const triageReport = z.object({
  generatedFrom: z.object({ clusterCount: z.number(), issueCount: z.number() }),
  summary: z.string(),
  backlog: z.array(backlogItem),
});
export type TriageReport = z.infer<typeof triageReport>;

/** Label suggestions per cluster key. */
const SUGGESTED_LABELS: Record<string, string[]> = {
  security: ['security', 'priority:critical'],
  bug: ['bug', 'needs-triage'],
  performance: ['performance'],
  docs: ['documentation', 'good first issue'],
  feature: ['enhancement'],
  question: ['question'],
  uncategorized: ['needs-triage'],
};

function draftResponseFor(c: Cluster): string {
  const lead = c.issueNumbers
    .slice(0, 5)
    .map((n) => `#${n}`)
    .join(', ');
  switch (c.key) {
    case 'security':
      return `Thanks for the report. We treat security issues (${lead}) as ${c.priority} priority and will investigate immediately. Please avoid sharing further exploit details publicly.`;
    case 'bug':
      return `Thanks for flagging this. To reproduce ${lead}, could you share your version, OS, and a minimal repro? We've triaged this as ${c.priority} priority.`;
    case 'performance':
      return `Appreciate the performance report (${lead}). If you can share a profile or benchmark, it will help us prioritise. Marked ${c.priority}.`;
    case 'docs':
      return `Thanks — documentation gaps like ${lead} are great first contributions. We'd happily review a PR; otherwise we'll schedule this (${c.priority}).`;
    case 'feature':
      return `Thanks for the suggestion (${lead}). We've logged it as a ${c.priority}-priority enhancement and will gauge demand before committing to a timeline.`;
    case 'question':
      return `Thanks for reaching out (${lead}). Converting this to a discussion may help; in the meantime here's a pointer to the docs. Marked ${c.priority}.`;
    default:
      return `Thanks for opening ${lead}. We've added it to the backlog at ${c.priority} priority and will follow up after triage.`;
  }
}

const draft_triage_report = defineTool({
  name: 'draft_triage_report',
  namespace: NS,
  description:
    'Turn prioritised issue clusters into a ranked backlog with drafted maintainer responses. Consumes cluster_issues output.',
  inputSchema: clusterSet,
  outputSchema: triageReport,
  handler: async (input) => {
    const backlog = input.clusters
      .slice()
      .sort((a, b) => b.score - a.score)
      .map((c, idx) => ({
        rank: idx + 1,
        clusterKey: c.key,
        category: c.category,
        priority: c.priority,
        issueNumbers: c.issueNumbers,
        suggestedLabels: SUGGESTED_LABELS[c.key] ?? ['needs-triage'],
        draftResponse: draftResponseFor(c),
      }));

    const top = backlog[0];
    const summary =
      backlog.length === 0
        ? 'No issues to triage.'
        : `${input.totalIssues} issue(s) across ${input.clusterCount} cluster(s). ` +
          `Top priority: ${top?.category} (${top?.priority}, ${top?.issueNumbers.length} issue(s)).`;

    return {
      generatedFrom: { clusterCount: input.clusterCount, issueCount: input.totalIssues },
      summary,
      backlog,
    };
  },
});

export const triageTools: AnyToolDefinition[] = [cluster_issues, draft_triage_report];
