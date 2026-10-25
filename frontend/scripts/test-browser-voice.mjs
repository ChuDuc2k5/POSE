import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import * as fixture from './calling-test-process.mjs';
let checks=0,socket;
const live=process.argv.includes('--live');
const aiUrl=process.env.AI_API_URL||'http://localhost:1234/v1';
if(live){try{const r=await fetch(aiUrl.replace(/\/$/,'')+'/models',{signal:AbortSignal.timeout(3000)});if(!r.ok)throw Error('Unavailable');}catch{console.log('SKIP: live browser voice namespace; LM Studio unreachable.');await fixture.closeCallingFixture();process.exit(0);}}
const check=(value,label)=>{assert.ok(value,label);checks++;};
try{
 await fixture.startCallingFixture(live?{aiUrl,model:process.env.AI_MODEL||'qwen3-4b-instruct-2507'}:{});
 await fixture.owner("update property_products set transaction_type='Rent',price_period='Month',price=12000000 where id=$1",[fixture.productId]);
 socket=io(fixture.origin+'/voice',{transports:['websocket'],auth:{token:'fixture-admin'},addTrailingSlash:false});
 await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
 const replies=[];socket.on('reply',r=>replies.push(r));
 const send=(event,data={})=>new Promise((resolve,reject)=>socket.timeout(live?125000:10000).emit(event,data,(error,result)=>error?reject(error):result.error?reject(Error(result.error)):resolve(result)));
 const started=await send('start',{script_version_id:fixture.publishedId,property_id:fixture.productId});
 check(started.label==='Mô phỏng — không có cuộc gọi thật','simulation label');
 let call=(await fixture.owner('select * from calls where id=$1',[started.call_id])).rows[0];
 check(call.call_type==='MOCK_CALL'&&call.provider==='simulator'&&call.status==='ANSWERED'&&call.phone_e164===null,'persistent browser call has no dialled number');
 check(await fixture.scalar('select count(*)::integer from call_turns where call_id=$1',[call.id])===0,'unconsented greeting not stored');
 check(replies[0].state.phase==='AIVoice','greeting before independent permission');
 await fixture.cronCall('dispatch');
 check(await fixture.scalar("select count(*)::integer from calls where status in ('CALLING','RINGING','ANSWERED','ENDING','UNKNOWN')")===2,'browser session participates in global admission');
 check((await fixture.stats()).received===1,'only one phone call fits beside the browser session');
 const blocked=io(fixture.origin+'/voice',{transports:['websocket'],auth:{token:'fixture-admin'},addTrailingSlash:false});
 try{await new Promise((resolve,reject)=>{blocked.once('connect',resolve);blocked.once('connect_error',reject);});const denied=await new Promise((resolve,reject)=>blocked.timeout(10000).emit('start',{script_version_id:fixture.publishedId},(error,result)=>error?reject(error):resolve(result)));check(denied.error?.includes('CAPACITY'),'third active call rejected');}finally{blocked.disconnect();}
 await send('utterance',{text:'đồng ý'});await send('utterance',{text:'không'});await send('utterance',{text:'đồng ý'});
 const turn=await send('utterance',{text:'Tôi cần tư vấn căn hộ tại Thủ Đức.'});
 check(turn.text&&turn.state.phase==='needs'&&turn.latency_ms>=0,'model turn returned with timing');
 if(!live)check(fixture.modelInput().listing_terms.some(p=>p.code==='M07-1'&&p.transaction_type==='Rent'&&p.price_period==='Month'),'browser voice model receives rental terms');
 if(live)console.log(`LIVE VOICE: ${turn.latency_ms} ms; reply: ${turn.text}`);
 await send('barge_in');
 check(await fixture.scalar('select count(*)::integer from call_turns where call_id=$1 and interrupted',[call.id])===1,'barge-in marks the stored AI turn');
 const interrupted=await send('utterance',{text:'Tôi muốn chuyên viên tư vấn.'});check(interrupted.interrupted,'next engine turn carries interruption');
 for(let n=0;n<3;n++){const response=await send('silence');check(response.state.silences===n+1,'silence counter');if(n===2)check(response.state.end_reason==='SILENCE','two reprompts then silence ends');}
 call=(await fixture.owner('select * from calls where id=$1',[call.id])).rows[0];check(call.status==='COMPLETED'&&call.end_reason==='SILENCE'&&call.transcript_status==='Available'&&call.recording_status==='NotConsented','terminal transcript and recording states are honest');
 check(await fixture.scalar('select count(*)::integer from call_events where call_id=$1 and type=$2',[call.id,'consent'])===3,'independent exact consent answers recorded');
 check(await fixture.scalar('select count(*)::integer from call_recordings where call_id=$1',[call.id])===0,'no browser audio uploaded');
 const detail=await(await fixture.call(`/api/calls/${call.id}`)).json();check(detail.consents.length===3&&detail.item.phone_e164===null,'browser call detail includes simulation consent evidence');
 const next=await send('start',{script_version_id:fixture.publishedId});
 for(const text of ['đồng ý','không','đồng ý'])await send('utterance',{text});
 const stopped=await fixture.call(`/api/calls/${next.call_id}/stop`,'POST',{reason:'Khách yêu cầu dừng mô phỏng'});check(stopped.ok&&(await stopped.json()).item.status==='COMPLETED','staff stop confirms browser simulation locally');
 check(await fixture.scalar('select transcript_status from calls where id=$1',[next.call_id])==='Available','staff stop finalizes consented transcript');
 const last=await send('start',{script_version_id:fixture.publishedId});socket.disconnect();
 for(let n=0;n<50;n++){if(await fixture.scalar('select status from calls where id=$1',[last.call_id])==='COMPLETED')break;await new Promise(resolve=>setTimeout(resolve,50));}
 check(await fixture.scalar('select status from calls where id=$1',[last.call_id])==='COMPLETED','disconnect releases active browser session');
 console.log(`PASS: ${checks} ${live?'live Qwen':'browser voice namespace/SQL'} checks; greeting, consent, reply, interruption and silence.`);
}finally{socket?.disconnect();await fixture.closeCallingFixture();}
