# `src/tools` — Tool registry

58 GitHub tools across 7 namespaces, satisfying CLAUDE.md invariant #1.

## Layout

- `types.ts` — `ToolDefinition` / `AnyToolDefinition`, `ToolContext`, namespace
  catalogue, and the `defineTool` helper (preserves schema types at the
  definition site, widens for storage).
- `schemas.ts` — compact, shared zod entity schemas + mappers. Handlers map raw
  GitHub payloads into these condensed shapes, so output validation always holds
  and tool outputs stay small.
- `registry.ts` — `ToolRegistry`: the single source of truth keyed by unique
  tool name, with namespace indexing.
- `exposure.ts` — **progressive exposure**, the only surface the orchestrator
  sees: `listNamespaces()`, `listTools(namespace)`, `getToolSchema(name)`, and
  the mechanical `invokeTool(name, args, ctx)` dispatcher. `invokeTool` validates
  args against the tool's zod schema, runs the handler, and validates the output;
  it contains no logic that *chooses* a tool — selection is model-driven.
- `namespaces/*.ts` — one module per namespace; every handler calls GitHub only
  through the Step-2 `GitHubClient`.
- `index.ts` — assembles the registry from all namespaces.

## Namespaces

| Namespace | Tools | Count |
| --- | --- | --- |
| `github-issues` | list, get, create, update, comment, list_comments, add_labels, remove_label, set_assignees, close, reopen, lock, list_events, search_in_repo | 14 |
| `github-prs` | list, get, get_diff, list_files, list_commits, list_reviews, create_review, request_reviewers, merge, list_comments, create_comment, get_mergeability | 12 |
| `github-repo` | get, list_branches, get_branch, list_contents, get_file, list_commits, get_commit, compare_commits, list_contributors, list_languages, list_topics | 11 |
| `github-actions` | list_workflows, get_workflow, list_runs, get_run, list_run_jobs, get_run_logs_url, rerun_workflow, cancel_run | 8 |
| `github-search` | search_issues, search_prs, search_code, search_repos, search_commits, search_users | 6 |
| `github-checks` | list_for_ref, get_run, list_suites | 3 |
| `github-releases` | list, get, get_latest, get_by_tag | 4 |
| **Total** | | **58** |

Tools default `owner`/`repo` to the configured sandbox repo when omitted.
