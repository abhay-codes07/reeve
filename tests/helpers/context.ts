/**
 * Test helpers: build a ToolContext whose GitHubClient is backed by msw.
 */

import { GitHubClient } from '../../src/github/client.js';
import { loadEnv, type Env } from '../../src/config/env.js';
import type { ToolContext } from '../../src/tools/index.js';

export const SANDBOX = { owner: 'octocat', repo: 'hello-world' } as const;

export function testEnv(): Env {
  return loadEnv(
    {
      GITHUB_TOKEN: 'ghp_test',
      GOOGLE_GENERATIVE_AI_API_KEY: 'goog_test',
      GITHUB_SANDBOX_REPO: `${SANDBOX.owner}/${SANDBOX.repo}`,
    },
    { reload: true },
  );
}

export function testContext(): ToolContext {
  const env = testEnv();
  const github = new GitHubClient(
    { auth: env.GITHUB_TOKEN, maxRequestRetries: 0, maxRateLimitRetries: 0 },
    env,
  );
  return { github, env };
}

/** Build a `https://api.github.com/...` URL for the sandbox repo. */
export function apiUrl(path: string): string {
  return `https://api.github.com/repos/${SANDBOX.owner}/${SANDBOX.repo}${path}`;
}
