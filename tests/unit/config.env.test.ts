import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';
import { ValidationError } from '../../src/errors/index.js';

const valid = {
  GITHUB_TOKEN: 'ghp_token',
  GOOGLE_GENERATIVE_AI_API_KEY: 'goog_key',
  GITHUB_SANDBOX_REPO: 'octocat/hello-world',
} satisfies NodeJS.ProcessEnv;

describe('loadEnv', () => {
  it('parses a complete environment and splits the sandbox slug', () => {
    const env = loadEnv(valid, { reload: true });
    expect(env.GITHUB_TOKEN).toBe('ghp_token');
    expect(env.sandbox).toEqual({ owner: 'octocat', repo: 'hello-world' });
    expect(env.NODE_ENV).toBe('development');
  });

  it('throws a ValidationError listing every missing variable', () => {
    expect(() => loadEnv({}, { reload: true })).toThrowError(ValidationError);
    try {
      loadEnv({}, { reload: true });
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const ve = err as ValidationError;
      expect(ve.message).toContain('GITHUB_TOKEN');
      expect(ve.message).toContain('GOOGLE_GENERATIVE_AI_API_KEY');
      expect(ve.message).toContain('GITHUB_SANDBOX_REPO');
      expect(ve.code).toBe('VALIDATION');
    }
  });

  it('rejects a malformed sandbox slug', () => {
    expect(() =>
      loadEnv({ ...valid, GITHUB_SANDBOX_REPO: 'not-a-slug' }, { reload: true }),
    ).toThrowError(/owner\/repo/);
  });

  it('memoises by default and reloads on request', () => {
    const first = loadEnv(valid, { reload: true });
    const second = loadEnv({ ...valid, GITHUB_TOKEN: 'changed' });
    expect(second).toBe(first); // cached
    const third = loadEnv({ ...valid, GITHUB_TOKEN: 'changed' }, { reload: true });
    expect(third.GITHUB_TOKEN).toBe('changed');
  });
});
