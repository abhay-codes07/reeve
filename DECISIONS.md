# DECISIONS

Running log of decisions made autonomously where the spec was underspecified.
One line each, with rationale.

## Step 2 — Foundation

- **pnpm via npm global, not corepack** — corepack couldn't write shims to
  `C:\Program Files\nodejs` (EPERM); `npm i -g pnpm` installs to the user prefix.
- **`pnpm-workspace.yaml` `allowBuilds`** — pnpm 11 no longer reads the `pnpm`
  field in package.json; build-script approval (esbuild, msw) lives in the
  workspace file.
- **TypeScript `NodeNext` + ESM (`"type": "module"`)** — matches Node 20+ and
  Mastra's ESM packaging; `verbatimModuleSyntax` keeps import/export intent explicit.
- **Extra-strict tsconfig** (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  etc.) — the charter demands strict; turn the strictest safe knobs on now while
  the surface is small.
- **Separate `tsconfig.build.json`** — typecheck covers tests + configs; the build
  emits only `src` to `dist` with declarations.
- **Model fallback shape = `ModelWithRetries[]`** — confirmed against installed
  `@mastra/core@1.41.0` types (`Agent.model` accepts `ModelWithRetries[]`); router
  strings `google/gemini-2.5-flash` / `-flash-lite` confirmed from Mastra docs.
- **Worker = single model, no chain** — subagents/eval-judge are scoped and
  short-lived; a fallback chain adds cost without meaningful resilience gain there.
- **403 disambiguation** — a 403 with `x-ratelimit-remaining: 0` / `retry-after`
  maps to `RateLimitError`; otherwise to `AuthError` (permission problem).
- **`doNotRetry` excludes 5xx & 429** — plugin-retry handles transient 5xx/network
  with exponential backoff; throttling plugin handles 429/secondary limits. We do
  not retry 400/401/403/404/422 (deterministic client errors).
- **Single Octokit choke point (`GitHubClient.request`)** — guarantees every call
  gets logging + taxonomy mapping; tools never construct their own Octokit.
- **`@octokit/request-error` as a direct dependency** — we import `RequestError`
  for `instanceof` checks in error mapping rather than relying on transitive resolution.
- **Two vitest projects (unit/integration)** — unit runs msw in `error` mode
  (hermetic, no network); integration runs handlers that simulate GitHub through
  the real plugin stack.
- **Logger silent under `NODE_ENV=test`** — keep test output clean unless
  `REEVE_LOG_LEVEL` is set explicitly.
- **Build emits JS only, no `.d.ts`** — the plugin-augmented Octokit type can't be
  named without a pnpm-internal path (TS2742) during declaration emit; Reeve is a
  deployable app, not a published library, so declarations add no value. Full
  strict typechecking still runs via `pnpm typecheck` (`tsc --noEmit`).
- **`@octokit/types` as a direct dep** — imported `EndpointDefaults` to type the
  throttling callbacks explicitly (the plugin's option types don't flow inference
  into the literal under strict mode).
