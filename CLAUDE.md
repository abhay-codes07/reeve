# CLAUDE.md — Reeve (Autonomous GitHub Maintainer Agent)

> Engineering charter for this repository. Every invariant below is non-negotiable.

## Mission

Reeve is a production-shaped autonomous agent that maintains a GitHub repository the way a
senior maintainer would: it triages issues, reviews pull requests, investigates regressions,
and keeps the backlog coherent. It plans, selects its own tools, delegates isolated subtasks to
scoped subagents, and runs long multi-step jobs without losing the thread. This is real
software, structured for deployment.

## Non-negotiable invariants

1. **Tool registry at scale.** 50+ tools across 4+ namespaces (separate MCP servers). Tool
   selection is driven by the model from tool descriptions — never a hand-written conditional
   dispatcher. The registry must stay coherent at 50 tools: namespaced, progressively exposed
   (load definitions on demand rather than dumping all 50 into context), and discoverable.
2. **Real subagent orchestration.** At least one tool spawns a subagent that runs in a
   genuinely isolated context window, holds its own scoped subset of tools, and returns a typed
   result to the parent. A relabelled function call does not count — isolation must be real and
   visible in the code.
3. **Long-horizon execution.** The agent completes a task spanning >=20 tool calls in a single
   session without losing plan coherence. The context-management strategy (plan persistence +
   compaction) is expressed explicitly in code, not left implicit.
4. **Production scaffolding.** Observability, retries with exponential backoff, rate limiting on
   external calls, typed error handling, an evaluation harness, and unit + integration tests.
   Structured for deployment.
5. **Composable tools.** At least one tool consumes the structured output of another, so tools
   chain rather than terminate at single calls.

## Architecture (decided — implement to this)

- **Stack:** TypeScript (strict) + Mastra (agents, workflows, memory, evals, observability),
  Node 20+, pnpm.
- **Model (free tier):** Google Gemini via Mastra's model router. Orchestrator and the
  long-horizon task run on `google/gemini-2.5-flash`; subagents and the eval LLM judge run on
  `google/gemini-2.5-flash-lite`. Configure a **model fallback chain** (flash -> flash-lite with
  per-model retries) so rate-limit (429) and 5xx errors degrade gracefully — this also absorbs
  free-tier rate limits. The runtime model is provider-swappable by design. **Confirm exact
  current model ids and Mastra APIs from the official docs — do not rely on memory.**
- **Namespaces (MCP servers):** `github-issues`, `github-prs`, `github-repo`,
  `github-actions`, `github-search`. Add `github-checks` and/or `github-releases` if needed to
  clear 50 tools. Each tool wraps a real GitHub REST/GraphQL call, with typed input/output
  schemas and a one-line description strong enough for model-driven selection.
- **Orchestrator:** a routing agent that interprets the task and selects
  tools / subagents / workflows by description. Tools are exposed progressively (on demand) so
  50 definitions never sit in context at once.
- **Subagents (orchestrator-worker):** e.g. `review_pr` and `investigate_issue`. Each spawns a
  worker with its OWN context window and a scoped tool subset (read-only where appropriate),
  runs independently, and returns a condensed typed result. Workers do not share context with
  the parent or with each other.
- **Flagship long-horizon task:** `triage_repository` — pull all open issues, cluster and
  prioritise them, draft maintainer responses, emit a ranked backlog. Must cross 20+ tool calls
  in one session. Persist the plan to memory and compact intermediate results as the run goes.
- **Composable chain:** `search_issues` -> `cluster_issues` -> `draft_triage_report`, each
  consuming the previous step's structured output.
- **Production layer:** wrap the GitHub client (Octokit) with throttling + retry (exponential
  backoff); typed error taxonomy; structured logging + Mastra observability; an eval harness
  with scored scenarios; vitest unit + integration suites. Keep the structure deployable.

## Working agreement (how we build together)

- Before implementing any phase, **propose a short plan first** (files to create/change + any
  decision with a material tradeoff, with options), then proceed. Do not over-engineer beyond
  this spec. Do not add dependencies without noting why.
- Work autonomously: for anything underspecified, make the decision a senior engineer would,
  append it to `DECISIONS.md` with a one-line rationale, and continue. **Do not pause to ask
  for confirmation** — stop only on a true blocker (won't compile, or would violate an invariant
  here).
- Commit in small, meaningful units with conventional-commit messages that tell the build
  story. Never squash the whole build into one commit.
- Every tool: typed input/output schema + clear description. Tests accompany features.
- Secrets live in env (`GITHUB_TOKEN`, `GOOGLE_GENERATIVE_AI_API_KEY`); never commit them.
  The repo is public.
- Keep a running `MEMO.md` scratchpad: what we built, what we cut, what more time would address,
  and one design decision worth defending against a reasonable alternative.
- If you're about to do something that conflicts with an invariant (a single big dispatcher, or
  a subagent that isn't truly isolated), flag it in DECISIONS.md and pick the compliant path.

## Definition of done

- [ ] 50+ tools across >=4 namespaces, selected by the model, progressively exposed.
- [ ] >=1 truly isolated subagent with scoped tools and a typed return.
- [ ] A single session demonstrably crosses 20 tool calls with the plan intact.
- [ ] Observability, retries+backoff, rate limiting, typed errors, eval harness,
      unit + integration tests all present.
- [ ] >=1 composed tool chain.
- [ ] Public repo, clean incremental commit history, README, MEMO.md at root.
