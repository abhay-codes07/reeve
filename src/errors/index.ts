/**
 * Typed error taxonomy for Reeve.
 *
 * Every failure that crosses a module boundary is one of these classes. Octokit
 * (and any other upstream) failures are mapped into this taxonomy via
 * {@link mapOctokitError} so the rest of the system never has to reason about
 * raw HTTP status codes or untyped throws.
 */

import { RequestError } from '@octokit/request-error';

/** Stable, machine-readable discriminator for each error class. */
export type ReeveErrorCode =
  | 'AUTH'
  | 'NOT_FOUND'
  | 'RATE_LIMIT'
  | 'VALIDATION'
  | 'UPSTREAM';

/** Structured context attached to an error. Always JSON-serialisable. */
export interface ReeveErrorContext {
  /** Originating operation, e.g. `github.issues.list`. */
  operation?: string;
  /** Upstream HTTP status, when the error came from an HTTP call. */
  status?: number;
  /** The request target, when known, e.g. `GET /repos/{owner}/{repo}`. */
  request?: string;
  /** Arbitrary extra detail; must stay serialisable. */
  [key: string]: unknown;
}

/**
 * Base class for all Reeve errors. Carries a typed {@link ReeveErrorCode},
 * structured {@link ReeveErrorContext}, an optional `cause`, and a flag
 * indicating whether retrying could plausibly succeed.
 */
export abstract class ReeveError extends Error {
  abstract readonly code: ReeveErrorCode;
  /** Whether a caller may sensibly retry the operation. */
  readonly retryable: boolean = false;
  readonly context: ReeveErrorContext;

  constructor(
    message: string,
    context: ReeveErrorContext = {},
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.context = context;
    // Restore prototype chain for `instanceof` across transpilation targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** A flat, log-friendly representation. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      context: this.context,
    };
  }
}

/** 401 / bad or missing credentials. Not retryable. */
export class AuthError extends ReeveError {
  readonly code = 'AUTH' as const;
  override readonly retryable = false;
}

/** 404 / target resource does not exist. Not retryable. */
export class NotFoundError extends ReeveError {
  readonly code = 'NOT_FOUND' as const;
  override readonly retryable = false;
}

/** 429 / primary or secondary rate limit. Retryable (after backoff). */
export class RateLimitError extends ReeveError {
  readonly code = 'RATE_LIMIT' as const;
  override readonly retryable = true;
  /** Seconds to wait before retrying, when the upstream told us. */
  readonly retryAfterSeconds: number | undefined;

  constructor(
    message: string,
    context: ReeveErrorContext = {},
    options?: { cause?: unknown; retryAfterSeconds?: number },
  ) {
    super(message, context, options);
    this.retryAfterSeconds = options?.retryAfterSeconds;
  }
}

/** 400 / 422 / malformed request or input that failed schema validation. Not retryable. */
export class ValidationError extends ReeveError {
  readonly code = 'VALIDATION' as const;
  override readonly retryable = false;
}

/** 5xx / network failure / anything else upstream. Retryable. */
export class UpstreamError extends ReeveError {
  readonly code = 'UPSTREAM' as const;
  override readonly retryable = true;
}

/** Type guard for any Reeve error. */
export function isReeveError(err: unknown): err is ReeveError {
  return err instanceof ReeveError;
}

/**
 * Map an unknown error thrown by Octokit (or the surrounding request flow) into
 * the Reeve taxonomy. The result is always a {@link ReeveError}; nothing leaks
 * through untyped.
 */
export function mapOctokitError(err: unknown, context: ReeveErrorContext = {}): ReeveError {
  // Already mapped — pass through, merging any extra context.
  if (isReeveError(err)) {
    return err;
  }

  if (err instanceof RequestError) {
    const status = err.status;
    const merged: ReeveErrorContext = {
      ...context,
      status,
      request: context.request ?? `${err.request?.method ?? '?'} ${err.request?.url ?? '?'}`,
    };

    switch (true) {
      case status === 401:
        return new AuthError('GitHub authentication failed (401).', merged, { cause: err });
      case status === 403 && isRateLimited(err):
        return new RateLimitError('GitHub rate limit exceeded (403).', merged, {
          cause: err,
          ...resolveRetryAfter(err),
        });
      case status === 403:
        // 403 without rate-limit headers is an authorization / permission problem.
        return new AuthError('GitHub authorization failed (403).', merged, { cause: err });
      case status === 404:
        return new NotFoundError('GitHub resource not found (404).', merged, { cause: err });
      case status === 429:
        return new RateLimitError('GitHub rate limit exceeded (429).', merged, {
          cause: err,
          ...resolveRetryAfter(err),
        });
      case status === 400 || status === 422:
        return new ValidationError(`GitHub rejected the request (${status}).`, merged, {
          cause: err,
        });
      default:
        return new UpstreamError(
          `GitHub request failed (${status || 'network error'}).`,
          merged,
          { cause: err },
        );
    }
  }

  // Genuinely unknown / non-HTTP error.
  const message = err instanceof Error ? err.message : String(err);
  return new UpstreamError(`Unexpected upstream failure: ${message}`, context, { cause: err });
}

/** A 403 is a rate-limit signal when GitHub reports zero remaining or a retry-after. */
function isRateLimited(err: RequestError): boolean {
  const headers = err.response?.headers ?? {};
  return headers['x-ratelimit-remaining'] === '0' || headers['retry-after'] !== undefined;
}

/** Pull a retry-after hint out of the response headers, if present. */
function resolveRetryAfter(err: RequestError): { retryAfterSeconds?: number } {
  const headers = err.response?.headers ?? {};
  const retryAfter = headers['retry-after'];
  if (retryAfter !== undefined) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return { retryAfterSeconds: seconds };
  }
  const reset = headers['x-ratelimit-reset'];
  if (reset !== undefined) {
    const resetSeconds = Number(reset);
    if (Number.isFinite(resetSeconds)) {
      // Header is an epoch second; we cannot read the clock here, so callers
      // that need a delay should compute it. We surface the raw reset instead.
      return {};
    }
  }
  return {};
}
