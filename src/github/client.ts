/**
 * GitHub client wrapper.
 *
 * A single Octokit instance, composed with the throttling and retry plugins, is
 * the ONLY path through which Reeve talks to GitHub. Every tool calls GitHub via
 * {@link GitHubClient.request}, which:
 *
 *  - applies primary + secondary rate-limit handling (throttling plugin),
 *  - retries 5xx / network failures with exponential backoff (retry plugin),
 *  - logs each operation through the shared structured logger, and
 *  - maps any failure into the typed error taxonomy (no untyped throws escape).
 *
 * Octokit API shapes confirmed against the official docs (June 2026):
 * `@octokit/rest@22`, `@octokit/plugin-throttling@11`, `@octokit/plugin-retry@8`.
 */

import { Octokit } from '@octokit/rest';
import { throttling } from '@octokit/plugin-throttling';
import { retry } from '@octokit/plugin-retry';
import type { EndpointDefaults } from '@octokit/types';
import type { Env } from '../config/env.js';
import { createOperationLogger, type Logger, rootLogger } from '../observability/logger.js';
import { mapOctokitError, type ReeveErrorContext } from '../errors/index.js';

/** Octokit composed with the throttling + retry plugins. */
const ReeveOctokit = Octokit.plugin(throttling, retry);

/** Underlying Octokit instance type, with plugin-augmented options. */
export type ReeveOctokitInstance = InstanceType<typeof ReeveOctokit>;

export interface GitHubClientOptions {
  /** Auth token. Defaults to `env.GITHUB_TOKEN`. */
  auth?: string;
  /** Override the Octokit instance entirely (used by tests). */
  octokit?: ReeveOctokitInstance;
  /** How many times the throttling plugin should retry a rate-limited request. */
  maxRateLimitRetries?: number;
  /** How many times the retry plugin should retry transient failures. */
  maxRequestRetries?: number;
  /** Base backoff in ms for retries/throttling. Lowered in tests for speed. */
  retryAfterBaseValue?: number;
  /** Logger to bind operations under. */
  logger?: Logger;
}

/**
 * Thin, typed wrapper around a throttled + retrying Octokit. Exposes the raw
 * `rest`/`graphql` surface for tools, plus {@link request} which adds logging
 * and taxonomy mapping around any Octokit call.
 */
export class GitHubClient {
  readonly octokit: ReeveOctokitInstance;
  private readonly log: Logger;

  constructor(opts: GitHubClientOptions = {}, env?: Env) {
    this.log = opts.logger ?? rootLogger;
    const maxRateLimitRetries = opts.maxRateLimitRetries ?? 2;
    const maxRequestRetries = opts.maxRequestRetries ?? 3;
    const baseValue = opts.retryAfterBaseValue;

    this.octokit =
      opts.octokit ??
      new ReeveOctokit({
        auth: opts.auth ?? env?.GITHUB_TOKEN,
        userAgent: 'reeve/0.1.0',
        throttle: {
          ...(baseValue !== undefined ? { retryAfterBaseValue: baseValue } : {}),
          // Primary rate limit: retry after the suggested cool-off, up to N times.
          onRateLimit: (
            retryAfter: number,
            requestOptions: Required<EndpointDefaults>,
            _octokit: unknown,
            retryCount: number,
          ) => {
            this.log.warn(
              {
                operation: 'github.throttle.primary',
                method: requestOptions.method,
                url: requestOptions.url,
                retryAfter,
                retryCount,
              },
              'Primary rate limit hit',
            );
            return retryCount < maxRateLimitRetries;
          },
          // Secondary (abuse) rate limit: same strategy, slightly tighter budget.
          onSecondaryRateLimit: (
            retryAfter: number,
            requestOptions: Required<EndpointDefaults>,
            _octokit: unknown,
            retryCount: number,
          ) => {
            this.log.warn(
              {
                operation: 'github.throttle.secondary',
                method: requestOptions.method,
                url: requestOptions.url,
                retryAfter,
                retryCount,
              },
              'Secondary rate limit hit',
            );
            return retryCount < maxRateLimitRetries;
          },
        },
        retry: {
          // Retry transient failures (5xx / network) up to N times with
          // exponential backoff. Set the count HERE, not via a global
          // `request.retries`: the latter stamps a retry budget onto every
          // request, which the retry plugin's Bottleneck limiter then honours
          // even for `doNotRetry` statuses — so 404/422 would be retried too.
          retries: maxRequestRetries,
          // Never retry these — they are deterministic client errors.
          doNotRetry: [400, 401, 403, 404, 422],
          ...(baseValue !== undefined ? { retryAfterBaseValue: baseValue } : {}),
        },
      });
  }

  /** The typed REST namespace (`client.rest.issues.listForRepo`, etc.). */
  get rest(): ReeveOctokitInstance['rest'] {
    return this.octokit.rest;
  }

  /** The GraphQL client, for queries the REST API cannot express efficiently. */
  get graphql(): ReeveOctokitInstance['graphql'] {
    return this.octokit.graphql;
  }

  /**
   * Run an Octokit operation with structured logging and typed error mapping.
   * This is the single choke point every tool uses, so observability and the
   * error taxonomy are guaranteed, not per-call best-effort.
   *
   * @param operation dotted name for logs, e.g. `github.issues.list`
   * @param fn        receives the underlying Octokit instance
   */
  async request<T>(
    operation: string,
    fn: (octokit: ReeveOctokitInstance) => Promise<T>,
    context: ReeveErrorContext = {},
  ): Promise<T> {
    const log = createOperationLogger({ operation, ...context }, this.log);
    const start = performance.now();
    log.debug('github.request.start');
    try {
      const result = await fn(this.octokit);
      log.info(
        { durationMs: Math.round(performance.now() - start) },
        'github.request.success',
      );
      return result;
    } catch (err) {
      const mapped = mapOctokitError(err, { operation, ...context });
      log.error(
        {
          durationMs: Math.round(performance.now() - start),
          err: mapped.toJSON(),
        },
        'github.request.failure',
      );
      throw mapped;
    }
  }
}

let shared: GitHubClient | undefined;

/**
 * Get a process-wide {@link GitHubClient}. Constructed lazily from the validated
 * env on first use. Pass `opts.octokit` (and call with `reset`) in tests to
 * inject a mock transport.
 */
export function getGitHubClient(env: Env, opts: GitHubClientOptions = {}): GitHubClient {
  if (!shared || opts.octokit) {
    shared = new GitHubClient(opts, env);
  }
  return shared;
}

/** Reset the shared client. Test-only helper. */
export function resetGitHubClient(): void {
  shared = undefined;
}
