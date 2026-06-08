import type { AnyToolDefinition } from '../../tools/index.js';
import { review_pr } from './review-pr.js';
import { investigate_issue } from './investigate-issue.js';

/** The subagent-spawning tools, for registration into the orchestrator's registry. */
export const subagentTools: AnyToolDefinition[] = [review_pr, investigate_issue];

export {
  REVIEW_PR_SCOPE,
  buildReviewPrBrief,
  createReviewPrSubagent,
  runReviewPr,
  review_pr,
} from './review-pr.js';
export {
  INVESTIGATE_ISSUE_SCOPE,
  buildInvestigateIssueBrief,
  createInvestigateIssueSubagent,
  runInvestigateIssue,
  investigate_issue,
} from './investigate-issue.js';
export {
  createSubagent,
  runSubagent,
  type SubagentSpec,
  type SubagentHandle,
} from './runner.js';
export {
  prReview,
  issueInvestigation,
  type PrReview,
  type IssueInvestigation,
} from './schemas.js';
