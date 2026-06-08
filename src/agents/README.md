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

## Subagents (Step 4+/later)

Subagents (`review_pr`, `investigate_issue`) will run in genuinely isolated
context windows with scoped, read-only-where-appropriate tool subsets and return
condensed typed results (model = `models.worker`).
