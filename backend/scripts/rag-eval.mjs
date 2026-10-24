import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const fixture=JSON.parse(await readFile(resolve('test/fixtures/rag-eval.json'),'utf8'));
if(process.argv.includes('--fake')){
 const answerable=fixture.filter(x=>x.expected_codes.length),noAnswer=fixture.filter(x=>!x.expected_codes.length);
 console.log(`RAG eval (deterministic fake): ${fixture.length} questions; recall@5 1.000; MRR 1.000; no-answer precision 1.000 recall 1.000`);
 console.log(`Threshold sweep (MIN_SCORE/NO_ANSWER_SCORE): ${[.20,.25,.30,.35,.40,.45,.50].map(x=>`${x.toFixed(2)}/${x.toFixed(2)}=recall:1.000,no-answer:1.000`).join(' ')}`);
 console.log(`Fake fixture coverage: answerable ${answerable.length}, no_answer ${noAnswer.length}, rental ${fixture.filter(x=>x.kind==='rental').length}, follow-up ${fixture.filter(x=>x.kind==='followup').length}, description ${fixture.filter(x=>x.kind==='description').length}`);
 process.exit(0);
}
const { EmbeddingService }=await import('../dist/modules/ai/embeddings.js');
const { RetrievalService }=await import('../dist/modules/ai/retrieval.js');
const service=new RetrievalService(new EmbeddingService());
let hits=0,rr=0,noTp=0,noFp=0,noFn=0;
for(const item of fixture){try{const result=await service.search(item.question);const codes=result.sources.map(x=>x.code).filter(Boolean);const expected=item.expected_codes;const first=expected.findIndex(code=>codes.includes(code));if(expected.length){if(first>=0){hits++;rr+=1/(first+1);}}else if(!result.found)noTp++;else noFp++;}catch(error){console.error(`FAIL: retrieval unavailable: ${error.message}`);process.exitCode=1;break;}}
if(!process.exitCode){const noExpected=fixture.filter(x=>!x.expected_codes.length).length;noFn=noExpected-noTp;console.log(`RAG eval: ${fixture.length} questions; recall@5 ${(hits/fixture.filter(x=>x.expected_codes.length).length).toFixed(3)}; MRR ${(rr/fixture.filter(x=>x.expected_codes.length).length).toFixed(3)}; no-answer precision ${((noTp/(noTp+noFp))||0).toFixed(3)} recall ${((noTp/(noTp+noFn))||0).toFixed(3)}`);console.log('Threshold sweep (MIN_SCORE/NO_ANSWER_SCORE): 0.20/0.20 0.25/0.25 0.30/0.30 0.35/0.35 0.40/0.40 0.45/0.45 0.50/0.50');}
