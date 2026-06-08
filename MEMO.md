# MEMO — build scratchpad

## What we built (Step 2 — foundation)

- pnpm + TypeScript (strict, ESM/NodeNext) project; scripts for typecheck/build/test.
- Zod env config with fail-fast aggregated errors and a parsed `owner/repo` split.
- Mastra model config: orchestrator fallback chain (`gemini-2.5-flash` →
  `gemini-2.5-flash-lite`) with per-model retries; worker = `flash-lite`. APIs and
  model ids confirmed against the installed `@mastra/core@1.41.0` types and docs.
- GitHub client: Octokit + throttling + retry, with logging and typed-error
  mapping centralised in one `request()` choke point.
- Typed error taxonomy with Octokit `RequestError` mapping.
- pino structured logger with operation-scoped child loggers.
- vitest unit + integration projects; msw makes unit tests hermetic.
- README, DECISIONS.md, .env.example.

## What we built (Step 3 — tool registry)

- 58 typed GitHub tools across 7 namespaces (issues 14, prs 12, repo 11, actions
  8, search 6, checks 3, releases 4), each with a zod input/output schema, a
  model-facing description, and a handler that calls GitHub only via the Step-2
  client.
- A single `ToolRegistry` (source of truth) + progressive exposure
  (`list_namespaces`, `list_tools`, `get_tool_schema`, `invoke_tool`). The model
  never sees all 58 defs at once; it discovers and selects by name.
- `invoke_tool` is a mechanical dispatcher: validate args → run handler →
  validate output, mapping failures into the taxonomy. No tool-selection logic.
- 47 tests total (msw-mocked, network-hermetic): >=2 tools per namespace,
  registry shape, exposure, and invoke_tool validation + error mapping.

## What we built (Step 4 — orchestrator + composable chain)

- Orchestrator Mastra Agent on the fallback-chain model, given only the 4
  progressive-exposure tools. Tool selection is fully model-driven — no hand-coded
  routing. `invoke_tool` returns `{ ok, result | error }` for self-correction.
- Composable chain `search_issues → cluster_issues → draft_triage_report` with
  typed handoffs shared by reference (output[n] IS input[n+1]). `runTriageChain`
  pipes it through `invokeTool` so every boundary is validated.
- New `triage` namespace (cluster_issues, draft_triage_report) — deterministic
  transforms, registered in the single registry (now 60 tools / 8 namespaces).
- Tests: unit schema-lineup (referential + real data flow) and an integration
  test running the chain end-to-end against the real sandbox repo.

## What we built (sandbox seed + subagents)

- `scripts/seed.ts`: seeded the sandbox with 10 varied open issues (+ labels),
  idempotent by title. Issues only (PAT is Contents:read-only).
- Fixed a retry bug: a global `request.retries` caused the retry plugin to retry
  even `doNotRetry` 4xx statuses (404/422 retried 3×). Moved to `retry.retries`.
- Real isolated subagents (`review_pr`, `investigate_issue`) per invariant #2:
  separate worker-model Agent, brief-only input, a scoped `registry.subset` of
  read-only tools, typed structured return. Registered as discoverable tools in
  the orchestrator registry; base registry stays subagent-free (scope source).
- Subagent structured output uses a separate tools-free structuring pass
  (Gemini can't mix function-calling with native JSON response format); the
  system stamps the authoritative PR/issue number rather than trusting the model.
- Tests: 8 isolation unit tests (scoped toolset, can't reach out-of-scope,
  brief-only input, fresh threadId, discoverable-but-non-recursive) + live
  integration tests (self-skip on free-tier 429 / no PRs / no creds).

## What we built (long-horizon triage_repository)

- `triage_repository(ctx, opts)`: deterministic controlled loop — record PLAN →
  paginate ALL open issues → cluster → gather context + run investigate_issue on
  top items → draft ranked backlog. Crosses 20+ tool calls (~27 on the 10-issue
  sandbox), tracked by a ToolCallCounter logged through observability.
- Explicit context management: `TriageMemory`/`InMemoryTriageMemory` persists the
  plan + a state bag, and COMPACTS every processed batch (page, cluster, each
  investigation) to a one-line summary so the working set stays bounded.
- `scripts/triage-demo.ts`: live demo (run after quota resets) that prints the
  tool-call count + ranked backlog and FAILS FAST on a Gemini 429 (no retry loop).
- Unit tests only this step (mocked invoke + investigate, fully hermetic): plan
  persisted, compaction happens, counter > 20, backlog shape valid, pagination
  makes multiple calls, investigateLimit respected. No live Gemini call made.

## What we built (eval harness + production hardening)

- Eval harness (`src/eval`): 5 scored scenarios vs sandbox-mirroring fixtures, a
  two-mode scorer (deterministic + LLM judge), and `pnpm eval` with `--mock` for
  fully offline runs. The judge is the only live-model seam, isolated + mockable.
- Observability polish: orchestrator invoke_tool, subagent runner, and every
  triage tool call emit structured spans (operation, tool, latency, outcome); the
  tool-call count is logged live and reported in the result. README OBSERVABILITY
  section added.
- Resilience tests (hermetic): 5xx + 429 backoff retry, no-retry on 404/422,
  every external failure → typed error, and the model fallback chain switching
  flash → flash-lite on a simulated 429 (local mock models).
- Added `retryAfterBaseValue` to GitHubClient so backoff can be scaled down in
  tests. 67 unit + 11 (non-Gemini) integration tests green. No live Gemini call.

## What we cut / deferred

- The actual tools, agents, workflows, and eval harness (Steps 3–6) — only
  placeholders + READMEs for now.
- Mastra observability exporters (we have pino; Mastra tracing wires in later).
- A retry-after → absolute-delay computation in `RateLimitError` (we surface the
  hint; the throttling plugin already handles the live backoff).

## What more time would address

- Wire pino into Mastra's logger interface so agent traces and our logs share
  context/correlation ids.
- Property-based tests for the error mapper across the full status matrix.
- A real integration smoke against the live sandbox repo behind an opt-in flag.

## One decision worth defending

**A single `GitHubClient.request()` choke point** instead of letting each tool
hold its own Octokit. The alternative (per-tool clients) is more flexible, but it
makes observability and the error taxonomy opt-in — easy to forget in one of 50
tools. Centralising guarantees every GitHub call is logged and every failure is
typed, which is exactly the production invariant the charter demands. The cost
(one indirection) is trivial next to that guarantee.
