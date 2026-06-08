/**
 * Unit test setup. Enforces hermeticity: any outbound HTTP request that has no
 * msw handler throws, so unit tests can never silently hit the network.
 */

import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from '../msw/server.js';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
