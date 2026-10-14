import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
if(!process.env.AI_API_URL){console.log('SKIP: live call conversation; AI_API_URL is unset.');process.exit(0);}
try{const url=new URL(process.env.AI_API_URL);url.pathname=url.pathname.replace(/\/+$/,'')+'/models';const r=await fetch(url,{signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error(`HTTP ${r.status}`);}catch(e){console.log(`SKIP: live call conversation; server unreachable (${e.message}).`);process.exit(0);}
const temp=await mkdtemp(join(tmpdir(),'pose-call-live-'));
try{
 for(const name of ['privacy','money','extraction','guard','llm','conversation']){
  const source=await readFile(new URL(name==='conversation' ? '../../backend/src/modules/calling/conversation.ts' : `../../backend/src/modules/ai/${name}.ts`,import.meta.url),'utf8');
  await writeFile(join(temp,name+'.mjs'),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/from '(?:\.\/|\.\.\/ai\/)([\w-]+)(?:\.js|\.ts)?'/g,"from './$1.mjs'"));
 }
 const {converse,initialConversation}=await import(pathToFileURL(join(temp,'conversation.mjs')));
 const script={greeting:'Xin chào.',ai_disclosure:'Tôi là trợ lý AI TERAVA.',purpose:'Tư vấn bất động sản.',consent_prompt:{ai_voice:'Bạn đồng ý tiếp tục với thoại AI?',recording:'Bạn đồng ý lưu ghi âm?',transcript:'Bạn đồng ý lưu bản chép lời?'},needs_questions:['Bạn cần sản phẩm như thế nào?'],closing:'Cảm ơn bạn.',opt_out:{confirmation:'Đã ghi nhận không liên hệ.'}};
 const evidence=[{id:'f6300000-0000-4000-8000-000000000001',code:'RV-A0805',name:'Căn hộ River View',price:3500000000,availability:'Available',updated_at:new Date().toISOString(),location:'Thủ Đức',property_type:'Apartment'}];
 let state=initialConversation(),count=0;
 for(const text of ['','đồng ý','không','đồng ý','Căn RV-A0805 ở đâu và giá bao nhiêu?','không quan tâm']){
  const start=performance.now(),result=await converse(state,script,{text},evidence);state=result.state;count++;
  console.log(`LIVE CALL ${count}: phase=${state.phase}; reason=${state.end_reason||'none'}; recording=${state.consents.Recording===true}; transcript=${state.consents.Transcript===true}; ${Math.round(performance.now()-start)} ms`);
  console.log(`reply: ${result.text}`);assert.notEqual(state.end_reason,'AI_ERROR');
 }
 assert.equal(state.end_reason,'DECLINED');assert.equal(state.consents.Recording,false);assert.equal(state.consents.Transcript,true);
 console.log(`PASS: ${count} live call conversation turns; independent consent and refusal respected.`);
}finally{await rm(temp,{recursive:true,force:true});}
