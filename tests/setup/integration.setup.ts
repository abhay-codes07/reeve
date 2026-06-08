/**
 * Integration test setup. msw is active and bypasses unhandled requests by
 * default; individual tests register handlers to simulate GitHub. Tests that
 * want strict mode can call `server.listen({ onUnhandledRequest: 'error' })`.
 */

import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from '../msw/server.js';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
