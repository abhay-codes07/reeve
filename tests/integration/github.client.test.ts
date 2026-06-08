/**
 * Integration test: a request flows through the real Octokit instance (with the
 * throttling + retry plugins composed) and the GitHubClient wrapper, with the
 * GitHub API simulated by msw. Asserts both the success path and that upstream
 * failures surface as the typed error taxonomy — not raw Octokit errors.
 */

import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { server } from '../msw/server.js';
import { GitHubClient } from '../../src/github/client.js';
import { NotFoundError, RateLimitError } from '../../src/errors/index.js';

function makeClient(): GitHubClient {
  // Tight retry budgets so the rate-limit test stays fast.
  return new GitHubClient({ auth: 'ghp_test', maxRequestRetries: 0, maxRateLimitRetries: 0 });
}

afterEach(() => server.resetHandlers());

describe('GitHubClient (integration via msw)', () => {
  it('returns data on the success path', async () => {
    server.use(
      http.get('https://api.github.com/repos/octocat/hello-world/issues', () =>
        HttpResponse.json([{ number: 1, title: 'First issue' }]),
      ),
    );

    const client = makeClient();
    const { data } = await client.request('github.issues.listForRepo', (octokit) =>
      octokit.rest.issues.listForRepo({ owner: 'octocat', repo: 'hello-world' }),
    );

    expect(data).toHaveLength(1);
    expect(data[0]?.title).toBe('First issue');
  });

  it('maps a 404 into NotFoundError', async () => {
    server.use(
      http.get('https://api.github.com/repos/octocat/ghost/issues', () =>
        HttpResponse.json({ message: 'Not Found' }, { status: 404 }),
      ),
    );

    const client = makeClient();
    await expect(
      client.request('github.issues.listForRepo', (octokit) =>
        octokit.rest.issues.listForRepo({ owner: 'octocat', repo: 'ghost' }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('maps a 429 into RateLimitError', async () => {
    server.use(
      http.get('https://api.github.com/repos/octocat/busy/issues', () =>
        HttpResponse.json({ message: 'rate limited' }, { status: 429, headers: { 'retry-after': '1' } }),
      ),
    );

    const client = makeClient();
    await expect(
      client.request('github.issues.listForRepo', (octokit) =>
        octokit.rest.issues.listForRepo({ owner: 'octocat', repo: 'busy' }),
      ),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it('does NOT retry a doNotRetry status, even with a retry budget', async () => {
    // Regression: a global request.retries used to make the retry plugin's
    // limiter retry 404/422 too. With a budget of 3, a 404 must still hit the
    // network exactly once.
    let calls = 0;
    server.use(
      http.get('https://api.github.com/repos/octocat/ghost/issues', () => {
        calls++;
        return HttpResponse.json({ message: 'Not Found' }, { status: 404 });
      }),
    );

    const client = new GitHubClient({
      auth: 'ghp_test',
      maxRequestRetries: 3,
      maxRateLimitRetries: 0,
    });
    await expect(
      client.request('github.issues.listForRepo', (octokit) =>
        octokit.rest.issues.listForRepo({ owner: 'octocat', repo: 'ghost' }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(calls).toBe(1);
  });
});
