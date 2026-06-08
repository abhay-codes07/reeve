# `src/agents` — Orchestrator & subagents

## Orchestrator (Step 4 — done)

`orchestrator.ts` builds the routing agent: a Mastra `Agent` on the orchestrator
model (`gemini-2.5-flash` with a `flash-lite` fallback). It is given ONLY the four
progressive-exposure tools — `list_namespaces`, `list_tools`, `get_tool_schema`,
`invoke_tool` — so the 58-tool registry never enters the prompt at once. The model
discovers what exists and selects tools by description/schema; there is **no
hand-coded routing**. `invoke_tool` returns `{ ok, result }` or
`{ ok:false, errorCode, error }` so the model can self-correct mid-run.

- `createOrchestrator(ctx, registry?)` — bind to an explicit `ToolContext`.
- `createDefaultOrchestrator()` — build from the validated env + real GitHub client.

## Subagents (done)

`subagents/` implements real orchestrator-worker isolation (CLAUDE.md invariant
#2). Two registry tools spawn workers:

- **`review_pr(prNumber)`** → typed `PrReview`. Scope: `prs_get`, `prs_get_diff`,
  `prs_list_files`, `prs_list_commits`, `repo_get_file`, `repo_compare_commits`.
- **`investigate_issue(issueNumber)`** → typed `IssueInvestigation`. Scope:
  `issues_get`, `issues_list_comments`, `issues_list_events`, `search_issues`,
  `repo_get_file`, `repo_list_commits`.

Why it's real isolation, not a relabelled call (see `runner.ts`):

1. **Separate agent** — a fresh `new Agent` on the worker model
   (`gemini-2.5-flash-lite`), distinct from the orchestrator.
2. **No parent context** — invoked with ONLY a task brief (a pure function of the
   PR/issue number); no Memory store, so each run starts from an empty thread
   tagged with a fresh `threadId`.
3. **Scoped tools** — drives a `registry.subset(scope)` that physically holds
   only its read-only subset; it cannot discover or invoke anything else.
4. **Typed return** — emits a zod-validated object; the parent receives only that.

The orchestrator registry (`buildOrchestratorRegistry`) = base tools + these two
subagent tools, so the model can delegate via the same progressive-exposure
surface. The base registry stays subagent-free and is the scope source.
