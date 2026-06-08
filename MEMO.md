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
