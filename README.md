# Reeve

> An autonomous GitHub maintainer agent.

Reeve maintains a GitHub repository the way a senior maintainer would: it triages
issues, reviews pull requests, investigates regressions, and keeps the backlog
coherent. It plans, selects its own tools, delegates isolated subtasks to scoped
subagents, and runs long multi-step jobs without losing the thread. Built on
[Mastra](https://mastra.ai) with Google Gemini models.

This repository is built in steps. **Step 2 (this commit range) lays the
production foundation**; the agent, tools, and workflows arrive in later steps.

## Architecture

```
            ┌──────────────────────────────────────────────┐
            │  Orchestrator agent (gemini-2.5-flash chain)  │
            │  routes by tool description, not a dispatcher  │
            └───────┬───────────────────────┬───────────────┘
                    │ delegates              │ selects
                    ▼                        ▼
        ┌───────────────────┐      ┌──────────────────────────┐
        │ Subagents (worker  │      │ Tool registry (50+ tools, │
        │ model, isolated    │      │ namespaced MCP servers,   │
        │ context, scoped    │      │ progressively exposed)    │
        │ tools, typed return)│     └────────────┬─────────────┘
        └────────────────────┘                   │ all GitHub calls
                                                  ▼
                              ┌────────────────────────────────────┐
                              │ GitHubClient (Octokit + throttling   │
                              │ + retry/backoff) ── single choke pt  │
                              └────────────────┬─────────────────────┘
                                               │ failures mapped to
                                               ▼
                              typed error taxonomy · structured logging
```

- **Stack:** TypeScript (strict) + Mastra + Node 20+ + pnpm.
- **Models:** Google Gemini via Mastra's model router. Orchestrator + long-horizon
  task use a fallback chain `gemini-2.5-flash → gemini-2.5-flash-lite` with
  per-model retries; subagents and the eval judge use `gemini-2.5-flash-lite`.
  Provider-swappable by design.
- **Namespaces (planned MCP servers):** `github-issues`, `github-prs`,
  `github-repo`, `github-actions`, `github-search` (+ `github-checks` /
  `github-releases` as needed to clear 50 tools).
- **Flagship long-horizon task:** `triage_repository` — pulls open issues,
  clusters and prioritises them, drafts responses, emits a ranked backlog, across
  20+ tool calls with the plan persisted and intermediate results compacted.
- **Composable chain:** `search_issues → cluster_issues → draft_triage_report`.

See [`CLAUDE.md`](./CLAUDE.md) for the full engineering charter and invariants,
and [`DECISIONS.md`](./DECISIONS.md) for autonomous decisions and their rationale.

## Layout

```
src/
  config/         # zod-validated env + shared Mastra model config (fallback chain)
  github/         # Octokit wrapper: throttling + retry, the single GitHub choke point
  errors/         # typed error taxonomy + Octokit → taxonomy mapping
  observability/  # pino structured logger with operation context
  tools/          # GitHub tool registry              (step 3+)
  agents/         # orchestrator + isolated subagents  (step 4+)
  workflows/      # composable chains + triage_repository (step 5+)
  eval/           # scored evaluation harness          (step 6+)
tests/
  unit/           # hermetic; msw blocks all network
  integration/    # real client + plugins, GitHub simulated by msw
  msw/ · setup/   # shared msw server + per-project setup
```

## Getting started

```bash
pnpm install
cp .env.example .env   # then fill in GITHUB_TOKEN, GOOGLE_GENERATIVE_AI_API_KEY, GITHUB_SANDBOX_REPO
```

Required environment (validated at startup — missing values fail fast):

| Variable | Purpose |
| --- | --- |
| `GITHUB_TOKEN` | GitHub PAT for all API calls |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google key read by Mastra's model router |
| `GITHUB_SANDBOX_REPO` | Target repo as `owner/repo` |

## Scripts

| Command | Description |
| --- | --- |
| `pnpm typecheck` | `tsc --noEmit` (strict) |
| `pnpm build` | Emit `dist/` from `src/` |
| `pnpm test` | Run unit + integration suites |
| `pnpm test:unit` / `pnpm test:integration` | Run one project |
| `pnpm dev` | Run the bootstrap entry point |

## Production foundation (Step 2)

- **Env config** — zod-validated, fail-fast with an aggregated error.
- **Model config** — Mastra model router with a fallback chain + per-model retries.
- **GitHub client** — Octokit composed with throttling (rate-limit aware) and
  retry (exponential backoff on 5xx/network); every tool calls GitHub only
  through it.
- **Error taxonomy** — `AuthError`, `NotFoundError`, `RateLimitError`,
  `ValidationError`, `UpstreamError`; Octokit failures map in, no untyped throws.
- **Observability** — pino structured logging with bound operation context.
- **Tests** — vitest unit + integration projects; msw guarantees unit tests never
  hit the network.
