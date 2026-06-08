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
