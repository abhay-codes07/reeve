# `src/workflows` — Composable chains & long-horizon tasks

## Composable chain (Step 4 — done)

`triage-chain.ts` wires Reeve's reference composition, satisfying CLAUDE.md
invariant #5 (tools that consume each other's structured output):

```
search_issues ──issueSet──▶ cluster_issues ──clusterSet──▶ draft_triage_report ──▶ triageReport
```

- **Typed handoffs by reference.** Each step's `outputSchema` is *the same zod
  object* as the next step's `inputSchema`:
  `search_issues.outputSchema === cluster_issues.inputSchema` (`issueSet`) and
  `cluster_issues.outputSchema === draft_triage_report.inputSchema`
  (`clusterSet`). `assertChainSchemasAlign()` proves it; the unit test also
  pushes real data through every hop.
- **Every hop is validated.** `runTriageChain()` pipes the steps through
  `invokeTool`, so each boundary is schema-checked and errors map into the
  taxonomy. Step 1 is a real GitHub call; steps 2–3 are deterministic transforms
  (`cluster_issues`, `draft_triage_report` in the `triage` namespace), keeping
  the chain reproducible and cheap to test.

## Long-horizon task (Step 5+)

The flagship `triage_repository` task that crosses 20+ tool calls in one session,
persisting its plan to memory and compacting intermediate results as it runs.
