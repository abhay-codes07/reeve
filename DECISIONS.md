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

## Step 3 — Tool registry

- **Custom registry, not Mastra MCP servers (yet)** — the spec requires a single
  registry with progressive exposure and a mechanical `invoke_tool`. A typed
  `ToolDefinition` registry models that directly; Step 4 wraps the 4 exposure
  operations as the Mastra tools handed to the agent. Selection stays model-driven.
- **Handlers map responses into compact typed outputs** — rather than echoing raw
  GitHub payloads. Keeps model context small and guarantees output-schema
  validation always passes (the handler builds exactly what the schema declares).
- **Tools default `owner`/`repo` to the sandbox** — the agent almost always
  operates on the configured sandbox repo; making them optional keeps call sites
  terse while still allowing cross-repo use (e.g. search).
- **`AnyToolDefinition` is structural with an `any` handler arg** — storing
  `ToolDefinition<SpecificIn, SpecificOut>` in a `ToolDefinition<ZodTypeAny,…>`
  array trips generic-function-parameter variance under strict mode. A structural
  erased type sidesteps it; per-tool handler type-checking still happens inside
  `defineTool`.
- **`zod-to-json-schema` dep** — `get_tool_schema` returns JSON Schema the model
  can read; zod 3.x has no built-in emitter, and this lib is the de-facto standard.
- **`prs_get_diff` returns raw diff text** — uses the `diff` media type, so the
  response body is a string, not the PR object; cast accordingly.
- **`issues_search_in_repo` auto-scopes the query** with `repo:owner/repo is:issue`
  so the model can pass plain search terms.
- **Tool names are `^[a-z][a-z0-9_]*$`** (e.g. `issues_list`) — globally unique and
  safe for model function-calling; namespace is stored as a separate field.
- **Split the `get_diff/list_files` bullet into two tools** — distinct, composable
  capabilities; brings github-prs to 12 and the total to 58 (comfortably >50).
