/**
 * Per-namespace tool handler tests (>=2 per namespace) and invoke_tool's
 * schema-validation + error-mapping behaviour. All GitHub traffic is mocked by
 * msw, so these run under the network-hermetic unit project.
 */

import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../msw/server.js';
import { apiUrl, testContext } from '../helpers/context.js';
import { buildRegistry, invokeTool } from '../../src/tools/index.js';
import { NotFoundError, ValidationError } from '../../src/errors/index.js';

const registry = buildRegistry();
const ctx = testContext();

// --- minimal response factories ------------------------------------------
const issue = (n: number) => ({
  number: n,
  title: `Issue ${n}`,
  state: 'open',
  user: { login: 'alice' },
  labels: [{ name: 'bug' }],
  assignees: [{ login: 'bob' }],
  comments: 2,
  created_at: '2020-01-01T00:00:00Z',
  updated_at: '2020-01-02T00:00:00Z',
  html_url: `https://github.com/x/${n}`,
  body: 'body',
});

const pull = (n: number) => ({
  number: n,
  title: `PR ${n}`,
  state: 'open',
  draft: false,
  user: { login: 'alice' },
  head: { ref: 'feature' },
  base: { ref: 'main' },
  created_at: '2020-01-01T00:00:00Z',
  updated_at: '2020-01-02T00:00:00Z',
  html_url: `https://github.com/x/pull/${n}`,
  body: 'b',
  merged: false,
  mergeable: true,
  mergeable_state: 'clean',
  comments: 1,
  review_comments: 0,
  commits: 3,
  additions: 10,
  deletions: 2,
  changed_files: 1,
});

const repoObj = {
  full_name: 'octocat/hello-world',
  description: 'desc',
  default_branch: 'main',
  visibility: 'public',
  stargazers_count: 5,
  forks_count: 1,
  open_issues_count: 3,
  topics: ['demo'],
  html_url: 'https://github.com/octocat/hello-world',
};

describe('github-issues handlers', () => {
  it('issues_list maps a list of issues', async () => {
    server.use(http.get(apiUrl('/issues'), () => HttpResponse.json([issue(1), issue(2)])));
    const out = (await invokeTool(registry, 'issues_list', {}, ctx)) as any;
    expect(out.count).toBe(2);
    expect(out.items[0]).toMatchObject({ number: 1, author: 'alice', labels: ['bug'] });
  });

  it('issues_get maps a single issue detail', async () => {
    server.use(http.get(apiUrl('/issues/42'), () => HttpResponse.json(issue(42))));
    const out = (await invokeTool(registry, 'issues_get', { issueNumber: 42 }, ctx)) as any;
    expect(out).toMatchObject({ number: 42, body: 'body', locked: false });
  });
});

describe('github-prs handlers', () => {
  it('prs_list maps pull request summaries', async () => {
    server.use(http.get(apiUrl('/pulls'), () => HttpResponse.json([pull(7)])));
    const out = (await invokeTool(registry, 'prs_list', {}, ctx)) as any;
    expect(out.items[0]).toMatchObject({ number: 7, headRef: 'feature', baseRef: 'main' });
  });

  it('prs_get_mergeability reads merge state', async () => {
    server.use(http.get(apiUrl('/pulls/7'), () => HttpResponse.json(pull(7))));
    const out = (await invokeTool(registry, 'prs_get_mergeability', { pullNumber: 7 }, ctx)) as any;
    expect(out).toEqual({ merged: false, mergeable: true, mergeableState: 'clean' });
  });
});

describe('github-repo handlers', () => {
  it('repo_get maps repository metadata', async () => {
    server.use(http.get(apiUrl(''), () => HttpResponse.json(repoObj)));
    const out = (await invokeTool(registry, 'repo_get', {}, ctx)) as any;
    expect(out).toMatchObject({ fullName: 'octocat/hello-world', stars: 5, topics: ['demo'] });
  });

  it('repo_list_branches maps branches', async () => {
    server.use(
      http.get(apiUrl('/branches'), () =>
        HttpResponse.json([{ name: 'main', commit: { sha: 'abc' }, protected: true }]),
      ),
    );
    const out = (await invokeTool(registry, 'repo_list_branches', {}, ctx)) as any;
    expect(out.items[0]).toEqual({ name: 'main', commitSha: 'abc', protected: true });
  });
});

describe('github-actions handlers', () => {
  it('actions_list_workflows maps workflows', async () => {
    server.use(
      http.get(apiUrl('/actions/workflows'), () =>
        HttpResponse.json({
          total_count: 1,
          workflows: [{ id: 1, name: 'CI', path: '.github/workflows/ci.yml', state: 'active' }],
        }),
      ),
    );
    const out = (await invokeTool(registry, 'actions_list_workflows', {}, ctx)) as any;
    expect(out.items[0]).toMatchObject({ id: 1, name: 'CI', state: 'active' });
  });

  it('actions_list_runs maps workflow runs', async () => {
    server.use(
      http.get(apiUrl('/actions/runs'), () =>
        HttpResponse.json({
          total_count: 1,
          workflow_runs: [
            {
              id: 10,
              name: 'CI',
              status: 'completed',
              conclusion: 'success',
              head_branch: 'main',
              event: 'push',
              run_number: 4,
              created_at: '2020-01-01T00:00:00Z',
              html_url: 'https://github.com/x/runs/10',
            },
          ],
        }),
      ),
    );
    const out = (await invokeTool(registry, 'actions_list_runs', {}, ctx)) as any;
    expect(out.totalCount).toBe(1);
    expect(out.items[0]).toMatchObject({ id: 10, conclusion: 'success' });
  });
});

describe('github-search handlers', () => {
  it('search_issues maps results and total', async () => {
    server.use(
      http.get('https://api.github.com/search/issues', () =>
        HttpResponse.json({ total_count: 1, items: [issue(3)] }),
      ),
    );
    const out = (await invokeTool(registry, 'search_issues', { query: 'bug' }, ctx)) as any;
    expect(out.totalCount).toBe(1);
    expect(out.items[0].number).toBe(3);
  });

  it('search_repos maps repository results', async () => {
    server.use(
      http.get('https://api.github.com/search/repositories', () =>
        HttpResponse.json({ total_count: 1, items: [repoObj] }),
      ),
    );
    const out = (await invokeTool(registry, 'search_repos', { query: 'cli' }, ctx)) as any;
    expect(out.items[0].fullName).toBe('octocat/hello-world');
  });
});

describe('github-checks handlers', () => {
  it('checks_list_for_ref maps check runs', async () => {
    server.use(
      http.get(apiUrl('/commits/abc/check-runs'), () =>
        HttpResponse.json({
          total_count: 1,
          check_runs: [
            {
              id: 1,
              name: 'build',
              status: 'completed',
              conclusion: 'success',
              head_sha: 'abc',
              started_at: '2020-01-01T00:00:00Z',
              completed_at: '2020-01-01T00:05:00Z',
              html_url: 'https://github.com/x/checks/1',
            },
          ],
        }),
      ),
    );
    const out = (await invokeTool(registry, 'checks_list_for_ref', { ref: 'abc' }, ctx)) as any;
    expect(out.items[0]).toMatchObject({ name: 'build', conclusion: 'success', headSha: 'abc' });
  });

  it('checks_get_run maps a single check run', async () => {
    server.use(
      http.get(apiUrl('/check-runs/9'), () =>
        HttpResponse.json({
          id: 9,
          name: 'lint',
          status: 'completed',
          conclusion: 'failure',
          head_sha: 'def',
          started_at: null,
          completed_at: null,
          html_url: 'https://github.com/x/checks/9',
        }),
      ),
    );
    const out = (await invokeTool(registry, 'checks_get_run', { checkRunId: 9 }, ctx)) as any;
    expect(out).toMatchObject({ id: 9, conclusion: 'failure' });
  });
});

describe('github-releases handlers', () => {
  const release = {
    id: 1,
    tag_name: 'v1.0.0',
    name: 'First',
    draft: false,
    prerelease: false,
    author: { login: 'alice' },
    created_at: '2020-01-01T00:00:00Z',
    published_at: '2020-01-02T00:00:00Z',
    html_url: 'https://github.com/x/releases/1',
  };

  it('releases_list maps releases', async () => {
    server.use(http.get(apiUrl('/releases'), () => HttpResponse.json([release])));
    const out = (await invokeTool(registry, 'releases_list', {}, ctx)) as any;
    expect(out.items[0]).toMatchObject({ tagName: 'v1.0.0', author: 'alice' });
  });

  it('releases_get_latest maps the latest release', async () => {
    server.use(http.get(apiUrl('/releases/latest'), () => HttpResponse.json(release)));
    const out = (await invokeTool(registry, 'releases_get_latest', {}, ctx)) as any;
    expect(out.tagName).toBe('v1.0.0');
  });
});

describe('invoke_tool dispatcher', () => {
  it('returns schema-validated output on success', async () => {
    server.use(http.get(apiUrl('/issues/1'), () => HttpResponse.json(issue(1))));
    const out = (await invokeTool(registry, 'issues_get', { issueNumber: 1 }, ctx)) as any;
    expect(out.number).toBe(1);
  });

  it('throws NotFoundError for an unknown tool name', async () => {
    await expect(invokeTool(registry, 'does_not_exist', {}, ctx)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('throws ValidationError when args fail the input schema', async () => {
    // issues_get requires issueNumber.
    await expect(invokeTool(registry, 'issues_get', {}, ctx)).rejects.toBeInstanceOf(
      ValidationError,
    );
    // wrong type for issueNumber
    await expect(
      invokeTool(registry, 'issues_get', { issueNumber: 'not-a-number' }, ctx),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('maps a GitHub 404 from the handler into NotFoundError', async () => {
    server.use(
      http.get(apiUrl('/issues/404'), () =>
        HttpResponse.json({ message: 'Not Found' }, { status: 404 }),
      ),
    );
    await expect(
      invokeTool(registry, 'issues_get', { issueNumber: 404 }, ctx),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
