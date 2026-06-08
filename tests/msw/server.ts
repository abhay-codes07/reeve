/**
 * Shared msw server for tests.
 *
 * The default export starts with no handlers. Unit tests run it in
 * `onUnhandledRequest: 'error'` mode so any real network call is a hard failure
 * — unit tests are guaranteed hermetic. Integration tests register handlers to
 * simulate GitHub responses flowing through the real client + plugins.
 */

import { setupServer } from 'msw/node';
import type { RequestHandler } from 'msw';

export const server = setupServer();

/** Convenience for integration tests: register handlers for one test. */
export function useHandlers(...handlers: RequestHandler[]): void {
  server.use(...handlers);
}
