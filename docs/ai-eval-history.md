# AI evaluation history

| date | commit | model | prompt versions | pass rate |
|---|---|---|---|---|
| 2026-10-24 | BEFORE | fixture/current | assistant@3, query@1, answer-meta@1, needs@1, rerank@1 | not run: baseline snapshot |
| 2026-10-24 | AFTER | fake provider | assistant@4, query@2, answer-meta@2, needs@2, rerank.system@2, rerank.user@2 | 30/30 (100%) |

Reproduce the offline run with `node backend/scripts/ai-eval.mjs --fake`. Live runs are
reviewer-only and are not executed in this worktree.
