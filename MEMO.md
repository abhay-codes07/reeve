# MEMO — Reeve

Reeve is a production-shaped autonomous GitHub maintainer agent: a Mastra
orchestrator on Google Gemini that discovers tools by description, delegates to
isolated subagents, and runs a long-horizon repository-triage task. This memo
reflects the **actual** build and the live run on 2026-06-09.

## 1. What I built — and how each invariant is satisfied

| # | Invariant | How it's met | Code pointer | Proof |
|---|---|---|---|---|
| 1 | Tool registry at scale, model-driven, progressively exposed | 62 tools across 9 namespaces; the model only ever sees 4 meta-tools and discovers the rest | `src/tools/registry.ts`, `src/tools/exposure.ts` | `tests/unit/tools.registry.test.ts`; live: `artifacts/smoke.txt` (discovery → invoke_tool) |
| 2 | Real subagent orchestration | Separate `Agent` on the worker model, brief-only input, `registry.subset()` read-only scope, typed return | `src/agents/subagents/runner.ts` | `tests/unit/subagents.isolation.test.ts`; live: `review_pr` returned a typed PrReview on PR #11 (`artifacts/review-pr.txt`) + 3 isolated investigations (`artifacts/triage-demo.txt`) |
| 3 | Long-horizon execution (≥20 tool calls) with explicit plan + compaction | Controlled loop persists a plan and compacts each batch to one line | `src/workflows/triage-repository.ts`, `triage-memory.ts` | `tests/unit/triage-repository.test.ts`; **live: 27 tool calls** in `artifacts/triage-demo.txt` |
| 4 | Production scaffolding | Throttle + exp-backoff retry, typed errors, structured spans, eval harness, unit+integration tests | `src/github/client.ts`, `src/errors/`, `src/observability/`, `src/eval/` | `tests/integration/github.resilience.test.ts`, `tests/unit/model-fallback.test.ts`, `tests/unit/eval.test.ts` |
| 5 | Composable tools (one consumes another) | `search_issues → cluster_issues → draft_triage_report`, schemas shared by reference | `src/workflows/triage-chain.ts` | `tests/unit/chain.schemas.test.ts`; `tests/integration/triage-chain.test.ts` |

**Live results:** smoke ✅ (`artifacts/smoke.txt`); flagship triage_repository ✅
**27 tool calls, 7 clusters, ranked backlog** (`artifacts/triage-demo.txt`);
**`review_pr` ✅ ran live on PR #11 and returned a typed PrReview**
(`artifacts/review-pr.txt`) — the isolated-subagent path is proven end-to-end
live; eval offline ✅ **5/5, score 1.00** (`artifacts/eval-mock.txt`).
Honest caveat: on the free-tier `flash-lite`, subagent *content* is thin (the PR
reviewer and some triage investigations under-used their tools — see §3); the
mechanism (isolation, scoped tools, typed return) is what's proven, not deep
review quality. The **live LLM judge** was not run this pass to conserve the
~20-req/day quota; the mock-judge eval (5/5) stands as the eval proof.

## 2. What I cut

- No persistent Mastra Memory backend — a lightweight in-process `TriageMemory`
  holds the plan/state; the interface is the seam for a DB-backed version later.
- No GraphQL tools, no write-heavy flows beyond what triage needs.
- Subagent `threadId` is a freshness/trace marker, not a persisted thread.
- Investigation *content* quality is limited by free-tier flash-lite (see §3).

## 3. What more time would address

- **Move the runtime model off the Gemini free tier.** The hard ceiling today is
  20 flash-lite requests/day; one full triage run exhausts it. A paid/higher-limit
  tier (or a provider swap — the model router makes this a one-line change in
  `src/config/models.ts`) would let `review_pr`, the live judge, and multiple
  triage runs all complete in one session. The free-tier weakness also showed in
  investigation quality (the subagent occasionally mis-targeted a tool).
- A retry-with-long-backoff or provider-fallback for the worker model (it has no
  fallback chain today, unlike the orchestrator).
- Broaden the eval set and add scored regression gating in CI.

## 4. One design decision I'd defend

**Deterministic triage orchestration with the LLM isolated inside the subagent —
rather than a single fully model-driven agentic loop.** `triage_repository` is a
controlled loop (`src/workflows/triage-repository.ts`); the only model surface is
the `investigate_issue` subagent. I'd defend this on three grounds the live run
bore out:

- **Reliability/coherence:** the loop deterministically crossed 27 tool calls
  with an intact plan; a fully model-driven loop on free-tier flash-lite would be
  far likelier to lose the thread (the subagent's own multi-step reasoning was
  already shaky — exactly the failure mode kept *out* of the control plane).
- **Reproducibility:** clustering, ranking, and drafting are pure functions, so
  the backlog is testable and stable (`pnpm eval --mock` scores them offline).
- **Cost:** the loop spends model tokens only where judgment is needed
  (investigation), which matters acutely under a 20-req/day budget.

The trade-off — less emergent flexibility than a free-roaming agent — is the
right one for a maintainer that must be trustworthy and cheap to run. Tool
*selection* stays fully model-driven (the orchestrator), so adaptivity lives
where it's safe.
