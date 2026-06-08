/**
 * Zod-validated environment configuration.
 *
 * Loads and validates every secret/setting Reeve needs at startup. If anything
 * is missing or malformed, {@link loadEnv} throws a single {@link ValidationError}
 * with a clear, aggregated message — we fail fast rather than discovering a
 * missing key three tool calls into a run.
 */

import { z } from 'zod';
import { ValidationError } from '../errors/index.js';

/**
 * `owner/repo` slug, e.g. `octocat/hello-world`. Validated shape so a typo'd
 * sandbox target is caught at boot, not at the first API call.
 */
const repoSlug = z
  .string()
  .trim()
  .regex(/^[\w.-]+\/[\w.-]+$/, 'must be in "owner/repo" form');

const envSchema = z.object({
  /** Fine-grained or classic PAT used for all GitHub calls. */
  GITHUB_TOKEN: z.string().trim().min(1, 'is required'),
  /** Google Generative AI key consumed by the Mastra model router (@ai-sdk/google). */
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().trim().min(1, 'is required'),
  /** The repository Reeve is allowed to operate on, as `owner/repo`. */
  GITHUB_SANDBOX_REPO: repoSlug,
  /** Optional runtime mode; defaults to `development`. */
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

/** Fully validated, immutable environment. */
export type Env = Readonly<z.infer<typeof envSchema>> & {
  /** Convenience split of {@link Env.GITHUB_SANDBOX_REPO}. */
  readonly sandbox: { readonly owner: string; readonly repo: string };
};

let cached: Env | undefined;

/**
 * Validate `source` (defaults to `process.env`) against the schema and return a
 * frozen {@link Env}. Throws {@link ValidationError} listing every problem.
 *
 * Result is memoised; pass `{ reload: true }` to re-read (used by tests).
 */
export function loadEnv(
  source: NodeJS.ProcessEnv = process.env,
  opts: { reload?: boolean } = {},
): Env {
  if (cached && !opts.reload) return cached;

  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'} ${issue.message}`)
      .join('\n');
    throw new ValidationError(
      `Invalid environment configuration:\n${details}\n\n` +
        'Set the required variables (see .env.example) and try again.',
      { operation: 'config.loadEnv', missing: parsed.error.issues.map((i) => i.path.join('.')) },
    );
  }

  const [owner, repo] = parsed.data.GITHUB_SANDBOX_REPO.split('/') as [string, string];
  cached = Object.freeze({
    ...parsed.data,
    sandbox: Object.freeze({ owner, repo }),
  });
  return cached;
}

/** Clear the memoised env. Test-only helper. */
export function resetEnvCache(): void {
  cached = undefined;
}
