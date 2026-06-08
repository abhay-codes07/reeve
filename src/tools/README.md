# `src/tools` — Tool registry

Step 3+. GitHub tools, namespaced (`github-issues`, `github-prs`, `github-repo`,
`github-actions`, `github-search`, …) toward the 50+-tool registry required by
CLAUDE.md. Each tool is defined with `createTool` from `@mastra/core/tools`, has
typed Zod input/output schemas and a model-selectable one-line description, and
calls GitHub **only** through `GitHubClient` (`src/github`). Definitions are
exposed progressively rather than all loaded into context at once.
