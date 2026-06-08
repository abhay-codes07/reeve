/**
 * Foundation smoke test: the env validates, the model config is well-formed, and
 * the GitHub client constructs. Runs under the unit project, so msw is in
 * `error` mode — constructing the client must not perform any network I/O.
 */

import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';
import { models, orchestratorModel, workerModel } from '../../src/config/models.js';
import { GitHubClient } from '../../src/github/client.js';

const env = loadEnv(
  {
    GITHUB_TOKEN: 'ghp_smoke',
    GOOGLE_GENERATIVE_AI_API_KEY: 'goog_smoke',
    GITHUB_SANDBOX_REPO: 'octocat/hello-world',
  },
  { reload: true },
);

describe('foundation smoke', () => {
  it('validates config into a frozen env', () => {
    expect(Object.isFrozen(env)).toBe(true);
    expect(env.sandbox.owner).toBe('octocat');
  });

  it('exposes an orchestrator fallback chain flash -> flash-lite with retries', () => {
    expect(orchestratorModel.map((m) => m.model)).toEqual([
      'google/gemini-2.5-flash',
      'google/gemini-2.5-flash-lite',
    ]);
    expect(orchestratorModel.every((m) => (m.maxRetries ?? 0) >= 1)).toBe(true);
    expect(models.orchestrator).toBe(orchestratorModel);
  });

  it('uses the lite model for workers', () => {
    expect(workerModel).toBe('google/gemini-2.5-flash-lite');
  });

  it('constructs a GitHub client without touching the network', () => {
    const client = new GitHubClient({ auth: env.GITHUB_TOKEN }, env);
    expect(client.octokit).toBeDefined();
    expect(client.rest.issues).toBeDefined();
    expect(typeof client.request).toBe('function');
  });
});
