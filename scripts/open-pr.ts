/**
 * Open a pull request in the sandbox repo via the GitHub client (PAT has
 * Pull requests: write). Branches must already be pushed (the PAT is
 * Contents:read-only, so code pushes go through the user's git credentials).
 *
 *   pnpm tsx scripts/open-pr.ts <head> <base>
 *
 * Idempotent-ish: if an open PR already exists for the head branch, it prints it
 * instead of failing.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

try {
  const text = readFileSync(resolve(process.cwd(), '.env'), 'utf-8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[1] && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {
  /* rely on ambient env */
}

const { loadEnv } = await import('../src/config/index.js');
const { getGitHubClient } = await import('../src/github/index.js');
const { isReeveError } = await import('../src/errors/index.js');

const head = process.argv[2] ?? 'reeve/sample-readme-note';
const base = process.argv[3] ?? 'main';

async function main(): Promise<void> {
  const env = loadEnv();
  const github = getGitHubClient(env);
  const { owner, repo } = env.sandbox;

  // Already open?
  const { data: existing } = await github.request('github.pulls.list', (o) =>
    o.rest.pulls.list({ owner, repo, state: 'open', head: `${owner}:${head}` }),
  );
  if (existing.length > 0) {
    const pr = existing[0]!;
    console.log(`PR already open: #${pr.number} ${pr.html_url}`);
    return;
  }

  try {
    const { data: pr } = await github.request('github.pulls.create', (o) =>
      o.rest.pulls.create({
        owner,
        repo,
        head,
        base,
        title: 'docs: add a Status section to the README',
        body:
          'Adds a short **Status** section to the README.\n\n' +
          'Sample PR created so Reeve\'s `review_pr` subagent has a live target to review.',
      }),
    );
    console.log(`Opened PR #${pr.number}: ${pr.html_url}`);
  } catch (err) {
    if (isReeveError(err)) {
      console.error(`Failed to open PR (${err.code}): ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

main().catch((err: unknown) => {
  console.error('open-pr failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
