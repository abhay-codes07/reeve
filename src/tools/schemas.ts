/**
 * Shared, compact entity schemas and mappers.
 *
 * Handlers map raw GitHub responses into these condensed shapes rather than
 * echoing full payloads. That keeps tool outputs small (cheaper context for the
 * model) and guarantees output-schema validation always holds, because the
 * handler constructs exactly what the schema describes.
 */

import { z } from 'zod';

/** Optional repo target; tools default to the sandbox repo when omitted. */
export const repoTarget = {
  owner: z.string().optional().describe('Repository owner. Defaults to the sandbox repo.'),
  repo: z.string().optional().describe('Repository name. Defaults to the sandbox repo.'),
};

/** Common pagination inputs. */
export const pagination = {
  perPage: z.number().int().min(1).max(100).optional().describe('Results per page (max 100).'),
  page: z.number().int().min(1).optional().describe('1-based page number.'),
};

// ---------------------------------------------------------------------------
// Entity schemas
// ---------------------------------------------------------------------------

export const userRef = z.object({
  login: z.string(),
  id: z.number(),
  type: z.string().nullable(),
});
export type UserRef = z.infer<typeof userRef>;

export const labelRef = z.object({
  name: z.string(),
  color: z.string().nullable(),
  description: z.string().nullable(),
});

export const issueSummary = z.object({
  number: z.number(),
  title: z.string(),
  state: z.string(),
  isPullRequest: z.boolean(),
  author: z.string().nullable(),
  labels: z.array(z.string()),
  assignees: z.array(z.string()),
  commentCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  url: z.string(),
});

/**
 * A set of issues — the output of `search_issues` and the input of
 * `cluster_issues`. Shared by reference so the composable chain's handoffs line
 * up exactly (output[n] === input[n+1]).
 */
export const issueSet = z.object({
  totalCount: z.number(),
  items: z.array(issueSummary),
});
export type IssueSet = z.infer<typeof issueSet>;

export const issueDetail = issueSummary.extend({
  body: z.string().nullable(),
  locked: z.boolean(),
  milestone: z.string().nullable(),
  closedAt: z.string().nullable(),
});

export const commentSummary = z.object({
  id: z.number(),
  author: z.string().nullable(),
  body: z.string().nullable(),
  createdAt: z.string(),
  url: z.string(),
});

export const prSummary = z.object({
  number: z.number(),
  title: z.string(),
  state: z.string(),
  draft: z.boolean(),
  author: z.string().nullable(),
  headRef: z.string(),
  baseRef: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  url: z.string(),
});

export const prDetail = prSummary.extend({
  body: z.string().nullable(),
  merged: z.boolean(),
  mergeable: z.boolean().nullable(),
  mergeableState: z.string().nullable(),
  comments: z.number(),
  reviewComments: z.number(),
  commits: z.number(),
  additions: z.number(),
  deletions: z.number(),
  changedFiles: z.number(),
});

export const commitSummary = z.object({
  sha: z.string(),
  message: z.string(),
  author: z.string().nullable(),
  authoredAt: z.string().nullable(),
  url: z.string(),
});

export const fileChange = z.object({
  filename: z.string(),
  status: z.string(),
  additions: z.number(),
  deletions: z.number(),
  changes: z.number(),
});

export const branchRef = z.object({
  name: z.string(),
  commitSha: z.string(),
  protected: z.boolean(),
});

export const repoSummary = z.object({
  fullName: z.string(),
  description: z.string().nullable(),
  defaultBranch: z.string(),
  visibility: z.string().nullable(),
  stars: z.number(),
  forks: z.number(),
  openIssues: z.number(),
  topics: z.array(z.string()),
  url: z.string(),
});

// ---------------------------------------------------------------------------
// Mappers (raw GitHub payload -> compact entity). Typed loosely as the Octokit
// response shapes are broad; we read only the fields the schemas declare.
// ---------------------------------------------------------------------------

type Raw = Record<string, any>;

export function mapUser(u: Raw | null | undefined): string | null {
  return u?.login ?? null;
}

export function mapIssueSummary(i: Raw): z.infer<typeof issueSummary> {
  return {
    number: i.number,
    title: i.title,
    state: i.state,
    isPullRequest: Boolean(i.pull_request),
    author: mapUser(i.user),
    labels: (i.labels ?? []).map((l: Raw | string) => (typeof l === 'string' ? l : l.name)),
    assignees: (i.assignees ?? []).map((a: Raw) => a.login),
    commentCount: i.comments ?? 0,
    createdAt: i.created_at,
    updatedAt: i.updated_at,
    url: i.html_url,
  };
}

export function mapIssueDetail(i: Raw): z.infer<typeof issueDetail> {
  return {
    ...mapIssueSummary(i),
    body: i.body ?? null,
    locked: Boolean(i.locked),
    milestone: i.milestone?.title ?? null,
    closedAt: i.closed_at ?? null,
  };
}

export function mapComment(c: Raw): z.infer<typeof commentSummary> {
  return {
    id: c.id,
    author: mapUser(c.user),
    body: c.body ?? null,
    createdAt: c.created_at,
    url: c.html_url,
  };
}

export function mapPrSummary(p: Raw): z.infer<typeof prSummary> {
  return {
    number: p.number,
    title: p.title,
    state: p.state,
    draft: Boolean(p.draft),
    author: mapUser(p.user),
    headRef: p.head?.ref ?? '',
    baseRef: p.base?.ref ?? '',
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    url: p.html_url,
  };
}

export function mapPrDetail(p: Raw): z.infer<typeof prDetail> {
  return {
    ...mapPrSummary(p),
    body: p.body ?? null,
    merged: Boolean(p.merged),
    mergeable: p.mergeable ?? null,
    mergeableState: p.mergeable_state ?? null,
    comments: p.comments ?? 0,
    reviewComments: p.review_comments ?? 0,
    commits: p.commits ?? 0,
    additions: p.additions ?? 0,
    deletions: p.deletions ?? 0,
    changedFiles: p.changed_files ?? 0,
  };
}

export function mapCommit(c: Raw): z.infer<typeof commitSummary> {
  return {
    sha: c.sha,
    message: c.commit?.message ?? '',
    author: c.author?.login ?? c.commit?.author?.name ?? null,
    authoredAt: c.commit?.author?.date ?? null,
    url: c.html_url,
  };
}

export function mapFileChange(f: Raw): z.infer<typeof fileChange> {
  return {
    filename: f.filename,
    status: f.status,
    additions: f.additions ?? 0,
    deletions: f.deletions ?? 0,
    changes: f.changes ?? 0,
  };
}

export function mapBranch(b: Raw): z.infer<typeof branchRef> {
  return {
    name: b.name,
    commitSha: b.commit?.sha ?? '',
    protected: Boolean(b.protected),
  };
}

export function mapRepo(r: Raw): z.infer<typeof repoSummary> {
  return {
    fullName: r.full_name,
    description: r.description ?? null,
    defaultBranch: r.default_branch,
    visibility: r.visibility ?? (r.private ? 'private' : 'public'),
    stars: r.stargazers_count ?? 0,
    forks: r.forks_count ?? 0,
    openIssues: r.open_issues_count ?? 0,
    topics: r.topics ?? [],
    url: r.html_url,
  };
}
