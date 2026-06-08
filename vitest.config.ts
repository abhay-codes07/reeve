import { defineConfig } from 'vitest/config';

/**
 * Two test projects:
 *
 *  - **unit**        — fast, hermetic. msw runs in `error` mode so any
 *                      unmocked outbound HTTP request fails the test. These
 *                      never touch the network.
 *  - **integration** — exercises the real wiring; may use msw mock handlers to
 *                      simulate GitHub responses end-to-end through the client.
 *
 * Run all: `pnpm test`. Run one: `pnpm test:unit` / `pnpm test:integration`.
 */
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          setupFiles: ['tests/setup/unit.setup.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          setupFiles: ['tests/setup/integration.setup.ts'],
          environment: 'node',
        },
      },
    ],
  },
});
