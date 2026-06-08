/**
 * Typed return shapes for the isolated subagents. The parent receives ONLY one
 * of these structured objects — never the subagent's conversation or tool chatter.
 */

import { z } from 'zod';

export const riskLevel = z.enum(['low', 'medium', 'high', 'critical']);

/** A single file-level finding from a PR review. */
export const prFinding = z.object({
  file: z.string(),
  severity: z.enum(['info', 'minor', 'major', 'critical']),
  finding: z.string(),
});

/**
 * The model-facing PR review body. It deliberately OMITS `prNumber`: the
 * identifier is an input the system owns, not something the model should echo
 * (models are unreliable at repeating ids). The run function stamps it on.
 */
export const prReviewBody = z.object({
  summary: z.string().describe('One-paragraph overview of what the PR does.'),
  riskLevel,
  findings: z.array(prFinding).describe('File-level review findings.'),
  suggestedChanges: z.array(z.string()).describe('Concrete change suggestions for the author.'),
});

/** Structured result returned by review_pr (body + the authoritative prNumber). */
export const prReview = prReviewBody.extend({ prNumber: z.number() });
export type PrReview = z.infer<typeof prReview>;

/** The model-facing investigation body (omits the system-owned `issueNumber`). */
export const issueInvestigationBody = z.object({
  summary: z.string().describe('One-paragraph restatement of the problem.'),
  category: z.string().describe('e.g. bug, performance, security, docs, question, feature.'),
  severity: riskLevel,
  likelyCauses: z.array(z.string()),
  relevantFiles: z.array(z.string()).describe('Files in the repo likely involved.'),
  suggestedNextSteps: z.array(z.string()),
  needsMoreInfo: z.boolean().describe('Whether the reporter must supply more detail to proceed.'),
});

/** Structured result returned by investigate_issue (body + authoritative issueNumber). */
export const issueInvestigation = issueInvestigationBody.extend({ issueNumber: z.number() });
export type IssueInvestigation = z.infer<typeof issueInvestigation>;
