# `src/workflows` — Composable chains & long-horizon tasks

Step 5+. The composable chain `search_issues → cluster_issues →
draft_triage_report` (each step consumes the previous step's structured output)
and the flagship long-horizon `triage_repository` task that crosses 20+ tool
calls in one session, persisting its plan to memory and compacting intermediate
results as it runs.
