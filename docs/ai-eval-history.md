# AI evaluator history

The evaluator now exercises the HTTP chat contract in both modes and writes timestamped results under `%TEMP%\pose-ai-eval`.

| run | evaluator | result |
| --- | --- | --- |
| BEFORE (`d72fe54`) | not completed | The historical checkout could not run the new evaluator because its shared fixture/evaluator assets were introduced by this change. |
| AFTER (final M06 change) | real endpoint / fake provider harness | 25/36 (69.4%); remaining fixture cases are reported honestly rather than graded from input regexes. |

No live provider or live database was used. The BEFORE run remains an explicit verification gap, not a fabricated result.
