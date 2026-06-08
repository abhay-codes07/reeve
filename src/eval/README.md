# `src/eval` — Evaluation harness

Scores Reeve's triage/investigation quality against fixtures that mirror the
seeded sandbox issues.

- `scenarios.ts` — 5 scored scenarios. Each `produce()` runs **offline**: the
  deterministic triage transforms (`cluster_issues`, `draft_triage_report`) are
  pure functions over fixture data; the investigation scenario uses a
  representative fixture.
- `scorer.ts` — two check modes. **Deterministic** checks assert on structured
  outcomes (categorisation, backlog ordering, non-empty fields). **Judge** checks
  delegate a fuzzy criterion to a `Judge`.
- `judge.ts` — `createLlmJudge()` (live, `google/gemini-2.5-flash-lite`) and
  `mockJudge` (offline stub). The judge is the **only** place the harness touches
  a live model, isolated behind the `Judge` type so it is fully mockable.

## Scenarios

| id | mode | asserts |
| --- | --- | --- |
| `crash-bug-categorised` | deterministic | crash bug → `bug` cluster, high/critical |
| `docs-categorised` | deterministic | docs issue → `Documentation` |
| `security-outranks-cosmetic` | deterministic | security ranks above the cosmetic typo |
| `investigation-actionable` | deterministic + judge | relevant files + next steps present; security problem + remediation identified |
| `draft-response-on-topic` | judge | top backlog item's drafted response is on-topic and actionable |

## Running

```bash
pnpm eval          # DEFAULT: live judge (hits Gemini). Fails fast on a 429.
pnpm eval --mock   # fully offline: stubbed judge; deterministic checks run for real.
```

`EVAL_MOCK=1` is equivalent to `--mock`. The runner exits non-zero if any
scenario fails, so it can gate automation.
