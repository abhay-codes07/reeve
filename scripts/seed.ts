/**
 * Seed the sandbox repo with realistic OPEN issues for triage exercises.
 *
 *   pnpm tsx scripts/seed.ts
 *
 * Creates the standard labels (bug, enhancement, documentation, question) if
 * missing, then opens ~10 varied issues — leaving a few intentionally unlabeled.
 * Idempotent: issues whose exact title already exists are skipped, so re-running
 * does not create duplicates.
 *
 * NOTE: the GitHub PAT is Contents:read-only. This script creates ISSUES and
 * LABELS only — it never creates branches, commits, or PRs (the user adds PRs
 * manually).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Load .env into process.env (tsx does not do this automatically).
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

interface SeedLabel {
  name: string;
  color: string;
  description: string;
}

const LABELS: SeedLabel[] = [
  { name: 'bug', color: 'd73a4a', description: "Something isn't working" },
  { name: 'enhancement', color: 'a2eeef', description: 'New feature or request' },
  { name: 'documentation', color: '0075ca', description: 'Improvements or additions to docs' },
  { name: 'question', color: 'd876e3', description: 'Further information is requested' },
];

interface SeedIssue {
  title: string;
  body: string;
  labels: string[];
}

const ISSUES: SeedIssue[] = [
  {
    title: 'App crashes on startup when config file is missing',
    body: 'Running `reeve start` with no `config.json` present throws an unhandled `ENOENT` and the process exits with a stack trace instead of a friendly error.\n\n**Steps to reproduce**\n1. Remove `config.json`\n2. Run `reeve start`\n\n**Expected:** a clear "config not found, run `reeve init`" message.\n**Actual:** raw `Error: ENOENT: no such file or directory` and exit code 1.',
    labels: ['bug'],
  },
  {
    title: 'Add dark mode support to the dashboard',
    body: 'It would be great to have a dark theme for the web dashboard. Many of us work at night and the bright white background is hard on the eyes. Ideally it would respect the OS `prefers-color-scheme` setting and also offer a manual toggle.',
    labels: ['enhancement'],
  },
  {
    title: 'Document the required environment variables in the README',
    body: 'The README does not list the environment variables the service needs to boot (`GITHUB_TOKEN`, `DATABASE_URL`, etc.). New contributors hit confusing runtime errors. Please add a configuration table and a `.env.example`.',
    labels: ['documentation'],
  },
  {
    title: 'Flaky test: UserService integration test fails intermittently',
    body: '`UserService > creates and fetches a user` fails roughly 1 in 5 CI runs with a timeout, but always passes locally. Suspect a race between the DB migration and the test setup. Re-running the job usually goes green, which is masking the underlying issue.',
    labels: ['bug'],
  },
  {
    title: 'Security: API tokens are written to logs in plaintext',
    body: 'When request logging is enabled, the `Authorization` header (containing the bearer token) is logged verbatim at info level. Anyone with log access can read live credentials. We should redact `Authorization`/`token` fields before logging.',
    labels: ['bug'],
  },
  {
    title: 'How do I configure the database connection pool size?',
    body: 'I need to raise the max number of DB connections under load but I cannot find a setting for it. Is it an environment variable, a config key, or hardcoded? A pointer to the right place in the docs would be enough.',
    labels: ['question'],
  },
  {
    title: 'Support YAML config files in addition to JSON',
    body: 'Our team standardizes on YAML for service config. It would be convenient if Reeve could read `config.yaml` as an alternative to `config.json`, picking whichever exists. Happy to help review a PR if there is interest.',
    labels: ['enhancement'],
  },
  // --- intentionally unlabeled below (needs triage) ---
  {
    title: 'Slow response when listing more than 1000 records',
    body: 'The `/records` endpoint takes 6-8 seconds once a tenant has more than ~1000 rows. Looks like it loads everything into memory and serializes it all at once. Pagination or streaming would help a lot.',
    labels: [],
  },
  {
    title: "Typo in CLI error message: 'occured' should be 'occurred'",
    body: 'Minor: the error printed on a failed sync reads "An error occured while syncing". Should be "occurred".',
    labels: [],
  },
  {
    title: 'Memory usage grows steadily during long-running jobs',
    body: 'During multi-hour batch jobs the RSS climbs from ~200MB to over 2GB and never comes back down until restart. Smells like a leak — possibly listeners or cache entries that are never released. Heap snapshots would help confirm.',
    labels: [],
  },
];

function hr(label: string): void {
  console.log(`\n${'='.repeat(8)} ${label} ${'='.repeat(8)}`);
}

async function main(): Promise<void> {
  const env = loadEnv();
  const github = getGitHubClient(env);
  const { owner, repo } = env.sandbox;

  hr('TARGET');
  console.log(`${owner}/${repo}`);

  // 1) Ensure labels exist.
  hr('LABELS');
  for (const label of LABELS) {
    try {
      await github.request('github.issues.createLabel', (o) =>
        o.rest.issues.createLabel({ owner, repo, ...label }),
      );
      console.log(`created  ${label.name}`);
    } catch (err) {
      // 422 (already exists) maps to ValidationError — that's fine.
      if (isReeveError(err) && err.code === 'VALIDATION') {
        console.log(`exists   ${label.name}`);
      } else {
        throw err;
      }
    }
  }

  // 2) Fetch existing open issue titles to stay idempotent.
  const { data: existing } = await github.request('github.issues.listForRepo', (o) =>
    o.rest.issues.listForRepo({ owner, repo, state: 'open', per_page: 100 }),
  );
  const existingTitles = new Set(
    existing.filter((i) => !i.pull_request).map((i) => i.title),
  );

  // 3) Create issues that don't already exist.
  hr('ISSUES');
  let created = 0;
  let skipped = 0;
  for (const issue of ISSUES) {
    if (existingTitles.has(issue.title)) {
      console.log(`skip   (exists) #?  ${issue.title}`);
      skipped++;
      continue;
    }
    const { data } = await github.request('github.issues.create', (o) =>
      o.rest.issues.create({
        owner,
        repo,
        title: issue.title,
        body: issue.body,
        ...(issue.labels.length ? { labels: issue.labels } : {}),
      }),
    );
    const labelStr = issue.labels.length ? `[${issue.labels.join(', ')}]` : '(unlabeled)';
    console.log(`create #${data.number} ${labelStr} ${issue.title}`);
    created++;
  }

  hr('SUMMARY');
  console.log(`created: ${created}  skipped(existing): ${skipped}  total defined: ${ISSUES.length}`);

  // 4) Confirm by re-listing.
  const { data: after } = await github.request('github.issues.listForRepo', (o) =>
    o.rest.issues.listForRepo({ owner, repo, state: 'open', per_page: 100 }),
  );
  const openIssues = after.filter((i) => !i.pull_request);
  console.log(`open issues now in repo: ${openIssues.length}`);
}

main().catch((err: unknown) => {
  hr('ERROR (verbatim)');
  if (err instanceof Error) {
    console.error(err.name + ':', err.message);
    if ((err as any).context) console.error('context:', JSON.stringify((err as any).context));
    console.error(err.stack);
  } else {
    console.error(err);
  }
  process.exitCode = 1;
});
