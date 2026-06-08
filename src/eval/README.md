# `src/eval` — Evaluation harness

Step 6+. Scored scenarios that exercise triage/review quality, with an LLM judge
running on `models.worker` (`gemini-2.5-flash-lite`). Produces comparable scores
across runs so changes to prompts/tools can be measured rather than guessed at.
