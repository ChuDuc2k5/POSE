# AI evaluator history

The evaluator now exercises the HTTP chat contract in both modes and writes timestamped results under `%TEMP%\pose-ai-eval`.

| run | evaluator | result |
| --- | --- | --- |
| BEFORE (`d72fe54`) | real endpoint / fake provider harness | 25/36 (69.4%); failures were refusal/tool/failure-fixture cases identified in the report |
| AFTER (final M06 change) | real endpoint / fake provider harness | 25/36 (69.4%); the same remaining fixture cases are reported honestly rather than graded from input regexes |

The BEFORE run used the same HTTP-grading evaluator against the `d72fe54` worktree state. No live provider or live database was used.
