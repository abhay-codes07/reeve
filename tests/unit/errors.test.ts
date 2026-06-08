import { describe, expect, it } from 'vitest';
import { RequestError } from '@octokit/request-error';
import {
  AuthError,
  NotFoundError,
  RateLimitError,
  UpstreamError,
  ValidationError,
  mapOctokitError,
  isReeveError,
} from '../../src/errors/index.js';

function requestError(
  status: number,
  headers: Record<string, string> = {},
): RequestError {
  return new RequestError(`HTTP ${status}`, status, {
    request: { method: 'GET', url: 'https://api.github.com/x', headers: {} },
    response: {
      status,
      url: 'https://api.github.com/x',
      headers,
      data: {},
      retryCount: 0,
    },
  });
}

describe('mapOctokitError', () => {
  it('maps 401 to AuthError (not retryable)', () => {
    const e = mapOctokitError(requestError(401));
    expect(e).toBeInstanceOf(AuthError);
    expect(e.retryable).toBe(false);
    expect(e.context.status).toBe(401);
  });

  it('maps 404 to NotFoundError', () => {
    expect(mapOctokitError(requestError(404))).toBeInstanceOf(NotFoundError);
  });

  it('maps 403 with exhausted rate-limit headers to RateLimitError (retryable)', () => {
    const e = mapOctokitError(requestError(403, { 'x-ratelimit-remaining': '0' }));
    expect(e).toBeInstanceOf(RateLimitError);
    expect(e.retryable).toBe(true);
  });

  it('maps a plain 403 to AuthError', () => {
    expect(mapOctokitError(requestError(403))).toBeInstanceOf(AuthError);
  });

  it('maps 429 to RateLimitError and reads retry-after', () => {
    const e = mapOctokitError(requestError(429, { 'retry-after': '30' }));
    expect(e).toBeInstanceOf(RateLimitError);
    expect((e as RateLimitError).retryAfterSeconds).toBe(30);
  });

  it('maps 422 to ValidationError', () => {
    expect(mapOctokitError(requestError(422))).toBeInstanceOf(ValidationError);
  });

  it('maps 500 to UpstreamError (retryable)', () => {
    const e = mapOctokitError(requestError(500));
    expect(e).toBeInstanceOf(UpstreamError);
    expect(e.retryable).toBe(true);
  });

  it('wraps unknown non-HTTP errors as UpstreamError', () => {
    const e = mapOctokitError(new Error('socket hang up'));
    expect(e).toBeInstanceOf(UpstreamError);
    expect(e.message).toContain('socket hang up');
  });

  it('passes already-mapped Reeve errors through unchanged', () => {
    const original = new NotFoundError('gone');
    expect(mapOctokitError(original)).toBe(original);
  });

  it('produces a serialisable shape and is recognised by the guard', () => {
    const e = mapOctokitError(requestError(500));
    expect(isReeveError(e)).toBe(true);
    expect(e.toJSON()).toMatchObject({ code: 'UPSTREAM', retryable: true });
  });
});
