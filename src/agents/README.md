# `src/agents` — Orchestrator & subagents

Step 4+. The orchestrator routing agent (model = `models.orchestrator` fallback
chain) selects tools/subagents/workflows by description. Subagents (`review_pr`,
`investigate_issue`) run in genuinely isolated context windows with scoped,
read-only-where-appropriate tool subsets and return condensed typed results
(model = `models.worker`).
