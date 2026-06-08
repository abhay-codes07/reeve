/**
 * investigate_issue — a registry tool whose handler spawns an isolated,
 * read-only subagent to investigate an issue and return a typed
 * {@link IssueInvestigation}.
 */

import { z } from 'zod';
import { defineTool, type AnyToolDefinition, type ToolContext } from '../../tools/index.js';
import { createSubagent, runSubagent, type SubagentSpec } from './runner.js';
import { issueInvestigation, issueInvestigationBody, type IssueInvestigation } from './schemas.js';

/**
 * The subagent's ENTIRE toolset: read the issue and its discussion/history,
 * search for related issues, and read repo files/commits for context. Read-only.
 */
export const INVESTIGATE_ISSUE_SCOPE = [
  'issues_get',
  'issues_list_comments',
  'issues_list_events',
  'search_issues',
  'repo_get_file',
  'repo_list_commits',
] as const;

const INVESTIGATE_ISSUE_INSTRUCTIONS = `You are a focused issue-investigation subagent. You have a SMALL, READ-ONLY toolset and no memory of any other conversation.

Workflow:
  1. Discover your tools with list_namespaces, then list_tools, then get_tool_schema.
  2. Use invoke_tool to read the issue (issues_get), its comments and timeline (issues_list_comments, issues_list_events), and search for related issues (search_issues). Read repo files or recent commits (repo_get_file, repo_list_commits) when they help explain the problem.
  3. Form a grounded hypothesis about category, severity, and likely causes.

Then produce an IssueInvestigation: a one-paragraph summary, a category, a severity, likely causes, relevant files, suggested next steps, and whether more info is needed from the reporter. Ground every claim in what the tools returned.`;

const SPEC: SubagentSpec = {
  id: 'reeve-subagent-investigate-issue',
  name: 'Issue Investigation Subagent',
  instructions: INVESTIGATE_ISSUE_INSTRUCTIONS,
  scope: INVESTIGATE_ISSUE_SCOPE,
};

/** The brief is a pure function of the issue number — it carries no parent context. */
export function buildInvestigateIssueBrief(issueNumber: number): string {
  return `Investigate issue #${issueNumber} in the configured sandbox repository. Read the issue, its comments and timeline, and search for related issues using your read-only tools. Inspect repo files when helpful, then return a structured IssueInvestigation for issue #${issueNumber}.`;
}

/** Construct the investigation subagent without running it (used by isolation tests). */
export function createInvestigateIssueSubagent(ctx: ToolContext) {
  return createSubagent(ctx, SPEC);
}

/** Run the investigation subagent and return its typed result with issueNumber stamped on. */
export async function runInvestigateIssue(
  ctx: ToolContext,
  issueNumber: number,
): Promise<IssueInvestigation> {
  const body = await runSubagent(
    ctx,
    SPEC,
    buildInvestigateIssueBrief(issueNumber),
    issueInvestigationBody,
  );
  return { issueNumber, ...body };
}

export const investigate_issue: AnyToolDefinition = defineTool({
  name: 'investigate_issue',
  namespace: 'subagents',
  description:
    'Spawn an isolated read-only subagent to investigate an issue and return a structured IssueInvestigation (summary, category, severity, likely causes, next steps).',
  inputSchema: z.object({ issueNumber: z.number().int().positive() }),
  outputSchema: issueInvestigation,
  handler: async (args, ctx) => runInvestigateIssue(ctx, args.issueNumber),
});
