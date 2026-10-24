# AI evaluator history

The evaluator now exercises the HTTP chat contract in both modes and writes timestamped results under `%TEMP%\pose-ai-eval`.

| run | evaluator | result |
| --- | --- | --- |
| BEFORE (`d72fe54`) | not completed | The historical checkout could not run the new evaluator because its shared fixture/evaluator assets were introduced by this change. |
| AFTER (M06 governance change 2) | real endpoint / fake provider harness | 30/36 (83.3%); refusal grading uses response scope and e02 uses fixture DATA-based no-answer judging. |

No live provider or live database was used. The BEFORE run remains an explicit verification gap, not a fabricated result.
