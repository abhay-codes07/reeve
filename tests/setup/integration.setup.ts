/**
 * Integration test setup. msw is active and bypasses unhandled requests by
 * default; individual tests register handlers to simulate GitHub. Tests that
 * want strict mode can call `server.listen({ onUnhandledRequest: 'error' })`.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from '../msw/server.js';

/**
 * Load .env into process.env for integration tests that talk to real services
 * (vitest does not do this automatically). Existing env vars win; lines that are
 * blank/comments are ignored. Missing .env is fine — such tests self-skip.
 */
function loadDotEnv(): void {
  try {
    const text = readFileSync(resolve(process.cwd(), '.env'), 'utf-8');
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match && match[1] && !(match[1] in process.env)) {
        process.env[match[1]] = match[2];
      }
    }
  } catch {
    // No .env file; rely on whatever is already in the environment.
  }
}

loadDotEnv();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
