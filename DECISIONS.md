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

## Step 4 — Orchestrator + composable chain

- **`triage` namespace for the chain transforms** — `cluster_issues` and
  `draft_triage_report` join the single registry so the model can discover and
  chain them via `invoke_tool`, exactly like GitHub tools. Total namespaces: 8.
- **Chain handoffs shared BY REFERENCE** — `search_issues.outputSchema` is the
  literal same zod object as `cluster_issues.inputSchema` (`issueSet`), and
  likewise `clusterSet`. Makes "output[n] is input[n+1]" impossible to break and
  trivially testable (referential `===`). Refactored `search_issues` to use the
  shared `issueSet`.
- **Clustering + drafting are deterministic transforms (no LLM/network)** — the
  chain is reproducible and the integration test is stable regardless of issue
  content. Model judgement lives in the orchestrator (and later the eval judge),
  not in these transforms.
- **`invoke_tool` meta-tool returns `{ ok, result | error }`** rather than throwing
  to the model — gives the long-horizon agent structured feedback to self-correct.
- **Orchestrator construction is explicit-context** — `createOrchestrator(ctx)` is
  pure/testable; `createDefaultOrchestrator()` wires real env + client. Avoids
  calling `loadEnv()` at import time (which would throw in env-less unit runs).
- **Integration tests load `.env` themselves** — added a tiny loader in the
  integration setup (vitest doesn't auto-load it); the chain test self-skips when
  no token is configured, so `pnpm test` stays green without credentials.

## Sandbox seed + retry fix + subagents

- **Seed script is idempotent by title** — re-running `scripts/seed.ts` skips
  issues that already exist, so it's safe to re-run. Issues + labels only (the
  PAT is Contents:read-only); the user adds PRs manually.
- **Retry bug fix (`request.retries` → `retry.retries`)** — a global
  `request.retries` made the retry plugin's Bottleneck limiter retry every
  failed request, including `doNotRetry` statuses (404/422 were retried 3×).
  Moving the count to the plugin's `retry.retries` makes `doNotRetry` effective.
- **Subagent isolation is structural, four ways** — separate `Agent` instance on
  the worker model; brief-only input (a pure function of the task params, no
  parent conversation); a SCOPED registry (`registry.subset`) that physically
  holds only the read-only subset so out-of-scope tools can't be discovered or
  invoked; and a typed structured return. Proven by `subagents.isolation.test.ts`.
- **Scope source = base (subagent-free) registry** — subagents scope from the
  base registry, while the orchestrator's registry adds the subagent tools. Keeps
  the dependency direction one-way (agents → tools), avoids cycles, and stops a
  subagent from scoping itself in recursively.
- **Structured output via a separate structuring model, not native on the
  tool-calling request** — Gemini rejects a JSON response mime type in the same
  request as function calling. Passing `structuredOutput: { schema, model:
  workerModel }` runs a tools-free structuring pass that emits native JSON and
  populates `result.object`. (`jsonPromptInjection` avoided the error but left
  `.object` empty.)
- **System owns the identifier, not the model** — `prNumber`/`issueNumber` are
  excluded from the model-facing body schema and stamped on by the run function;
  the model was unreliable at echoing them (returned `1.23` for issue 10).
- **Worker model has no fallback chain (per spec); free-tier 429s surface as
  errors** — subagent integration tests self-skip on a quota/rate-limit error
  (limit ~20 req/min for flash-lite), exactly as they skip without credentials,
  so `pnpm test` stays green. The path itself is verified when quota is available.

## Long-horizon task (triage_repository)

- **Controlled loop, not the LLM router** — `triage_repository` is deterministic
  orchestration in code. CLAUDE.md allows "workflow OR controlled agent loop";
  the loop gives reproducible coverage, a reliable >20 tool-call count, and full
  unit testability, while still satisfying long-horizon coherence. The only model
  surface is the `investigate_issue` subagent.
- **Lightweight in-process memory, not @mastra/memory** — `TriageMemory` +
  `InMemoryTriageMemory` persist the plan, compacted batch summaries, and a state
  bag with no DB dependency, keeping the task deterministic and hermetic to test.
  The interface is the seam for a Mastra Memory backend later.
- **Compaction = reduce each processed batch to one line** — pages, the cluster
  set, and each investigation are summarised into memory; only condensed
  representations (issue summaries, 4-field investigation records) are carried
  forward, so the working set stays bounded regardless of repo size.
- **Tool-call count includes GitHub reads + subagent calls** — to exceed 20
  without burning Gemini, the loop gathers per-issue context (get/comments/events)
  for the top items (GitHub, cheap) and limits `investigate_issue` (Gemini) to a
  small `investigateLimit` (default 3). On the 10-issue sandbox this is ~27 calls.
- **No live Gemini calls this step** — built code + mocked, network-hermetic unit
  tests only; injected `invoke`/`investigate` deps make the run testable without
  GitHub or Gemini. The Gemini-touching subagents integration test was NOT run
  (it would attempt a call to self-skip), to conserve the free-tier daily quota.
- **Demo fails fast on 429** — `scripts/triage-demo.ts` prints a clear "retry when
  quota resets" message and exits on a rate-limit error; it never retries in a
  loop, so it cannot burn quota.

## Eval harness + production hardening

- **Judge is the single live-model seam** — fuzzy criteria go through one `Judge`
  function (`createLlmJudge`); deterministic checks and all scenario `produce()`s
  are offline. `mockJudge` makes `pnpm eval --mock` fully hermetic. Default is the
  live judge; it fails fast on a 429.
- **Scenario subjects run offline** — the deterministic triage transforms are pure
  functions, so the eval scores real behaviour without GitHub or Gemini; the
  investigation scenario uses a representative fixture rather than a live subagent
  run, keeping the judge the only model touchpoint.
- **Model-fallback tested with local mock LanguageModelV2 objects** — a simulated
  429 from a hand-rolled V2 mock drives Mastra's real fallback (flash retried,
  then flash-lite), verified empirically before codifying. No live model, no
  added dependency (the AI SDK's MockLanguageModelV2 isn't exported in this
  version).
- **`retryAfterBaseValue` option on GitHubClient** — lets resilience tests scale
  backoff to ~1ms so retry behaviour is exercised fast; defaults to the plugin's
  1000ms in production.
- **Observability spans carry operation/tool/latency/outcome** — orchestrator
  `invoke_tool`, the subagent runner, and every triage tool call emit a structured
  span; the `ToolCallCounter` logs the running count and the result reports the
  total. Documented in the README OBSERVABILITY section.
- **No live Gemini call this step** — verified by running only the offline eval
  (`--mock`), the unit suite, and the non-Gemini integration files; the
  Gemini-touching subagents integration test was deliberately not run.
