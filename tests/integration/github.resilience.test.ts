/**
 * GitHub client resilience (network-hermetic via msw).
 *
 * Asserts: exponential-backoff retry on 5xx and 429; NO retry on 404/422; and
 * that every external failure surfaces as a typed taxonomy error. Backoff is
 * scaled down (retryAfterBaseValue: 1ms) so the retry behaviour is exercised
 * without slow waits.
 */

import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { server } from '../msw/server.js';
import { GitHubClient } from '../../src/github/client.js';
import {
  AuthError,
  NotFoundError,
  RateLimitError,
  UpstreamError,
  ValidationError,
} from '../../src/errors/index.js';

const URL = 'https://api.github.com/repos/octocat/hello-world/issues';

function client(opts: { maxRequestRetries?: number; maxRateLimitRetries?: number } = {}) {
  return new GitHubClient({
    auth: 'ghp_test',
    retryAfterBaseValue: 1, // ~1ms backoff so tests are fast
    maxRequestRetries: opts.maxRequestRetries ?? 3,
    maxRateLimitRetries: opts.maxRateLimitRetries ?? 2,
  });
}

const listIssues = (c: GitHubClient) =>
  c.request('github.issues.listForRepo', (o) =>
    o.rest.issues.listForRepo({ owner: 'octocat', repo: 'hello-world' }),
  );

afterEach(() => server.resetHandlers());

describe('GitHub client resilience', () => {
  it('retries a transient 5xx with backoff and then succeeds', async () => {
    let calls = 0;
    server.use(
      http.get(URL, () => {
        calls += 1;
        if (calls <= 2) return HttpResponse.json({ message: 'boom' }, { status: 503 });
        return HttpResponse.json([{ number: 1, title: 'ok' }]);
      }),
    );

    const { data } = await listIssues(client());
    expect(calls).toBe(3); // 2 failures + 1 success
    expect(data).toHaveLength(1);
  });

  it('gives up on a persistent 5xx after exhausting retries -> UpstreamError', async () => {
    let calls = 0;
    server.use(
      http.get(URL, () => {
        calls += 1;
        return HttpResponse.json({ message: 'down' }, { status: 500 });
      }),
    );

    await expect(listIssues(client({ maxRequestRetries: 2 }))).rejects.toBeInstanceOf(UpstreamError);
    expect(calls).toBe(3); // initial + 2 retries
  });

  it('retries a 429 rate limit and then succeeds', async () => {
    let calls = 0;
    server.use(
      http.get(URL, () => {
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json({ message: 'slow down' }, { status: 429, headers: { 'retry-after': '0' } });
        }
        return HttpResponse.json([{ number: 2, title: 'recovered' }]);
      }),
    );

    const { data } = await listIssues(client());
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(data[0]?.title).toBe('recovered');
  });

  it('does NOT retry 404 or 422 even with a retry budget', async () => {
    let calls404 = 0;
    server.use(
      http.get(URL, () => {
        calls404 += 1;
        return HttpResponse.json({ message: 'Not Found' }, { status: 404 });
      }),
    );
    await expect(listIssues(client())).rejects.toBeInstanceOf(NotFoundError);
    expect(calls404).toBe(1);

    let calls422 = 0;
    server.use(
      http.get(URL, () => {
        calls422 += 1;
        return HttpResponse.json({ message: 'Unprocessable' }, { status: 422 });
      }),
    );
    await expect(listIssues(client())).rejects.toBeInstanceOf(ValidationError);
    expect(calls422).toBe(1);
  });

  it('surfaces every external failure as a typed taxonomy error', async () => {
    const cases: Array<[number, Record<string, string>, unknown]> = [
      [401, {}, AuthError],
      [403, {}, AuthError],
      [403, { 'x-ratelimit-remaining': '0' }, RateLimitError],
      [404, {}, NotFoundError],
      [422, {}, ValidationError],
      [500, {}, UpstreamError],
    ];
    for (const [status, headers, type] of cases) {
      server.use(http.get(URL, () => HttpResponse.json({ message: 'x' }, { status, headers })));
      await expect(listIssues(client({ maxRequestRetries: 0 }))).rejects.toBeInstanceOf(type as never);
      server.resetHandlers();
    }
  });
});
