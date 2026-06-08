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

## Long-horizon task — `triage_repository` (done)

`triage-repository.ts` is the flagship long-horizon task (CLAUDE.md invariant #3):
a deterministic CONTROLLED LOOP that triages every open issue in one session,
comfortably crossing 20+ tool calls. The only model surface is the
`investigate_issue` subagent; everything else is GitHub reads + the deterministic
triage transforms, so it is reproducible and unit-testable.

Plan & context management (explicit, in code):

1. **Plan** is recorded to memory up front (gather → cluster → investigate →
   draft → backlog) via `triage-memory.ts`.
2. **Gather** paginates ALL open issues (`issues_list`, multiple pages); each page
   is **compacted** to a one-line summary — only the condensed issue list is
   carried forward (no bodies).
3. **Cluster** groups the issues; the cluster set is compacted to a summary line.
4. **Investigate** gathers per-issue context (get/comments/events) for the top
   items and runs the isolated `investigate_issue` subagent on the very top ones.
   Each investigation is **compacted** to a 4-field record — the full transcript
   is never retained, so the working set stays bounded.
5. **Draft** emits the ranked backlog with maintainer responses.

A `ToolCallCounter` logs the running count through the observability layer; the
result reports `totalToolCalls` (>20 on the seeded sandbox). Memory is a
lightweight in-process store (`InMemoryTriageMemory`) behind a `TriageMemory`
interface — swappable for a Mastra Memory backend later.

Run the live demo (after Gemini quota resets): `pnpm tsx scripts/triage-demo.ts`
— it prints the tool-call count and ranked backlog, and fails fast on a 429.
