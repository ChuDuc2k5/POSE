import { createHmac, timingSafeEqual } from 'node:crypto';
import { ProviderAmbiguous, ProviderRejected, type CallingProvider, type CallEvent } from '../provider.js';
async function request(path:string,body?:unknown){
 try{
  const response=await fetch(`${process.env.TELEPHONY_API_URL}${path}`,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${process.env.TELEPHONY_API_KEY}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(3000),cache:'no-store'});
  if(response.status>=500)throw new ProviderAmbiguous();
  if(!response.ok)throw new ProviderRejected(`HTTP_${response.status}`);
  return await response.json();
 }catch(error){if(error instanceof ProviderRejected)throw error;throw new ProviderAmbiguous();}
}
export const simulator:CallingProvider={
 dispatch:input=>request('/dispatch',input),hangup:id=>request(`/calls/${encodeURIComponent(id)}/hangup`,{}),fetchStatus:id=>request(`/calls/${encodeURIComponent(id)}`),estimateCostVnd:()=>null,
 verifyWebhook(raw,headers,now){
  const stamp=headers.get('x-terava-timestamp')||'',signature=headers.get('x-terava-signature')||'',secret=process.env.TELEPHONY_WEBHOOK_SECRET;
  if(!secret || !/^\d+$/.test(stamp) || Math.abs(now/1000-Number(stamp))>300 || !/^[a-f0-9]{64}$/.test(signature))throw Error('INVALID_SIGNATURE');
  const expected=createHmac('sha256',secret).update(`${stamp}.`).update(raw).digest();
  if(!timingSafeEqual(expected,Buffer.from(signature,'hex')))throw Error('INVALID_SIGNATURE');
  const event=JSON.parse(typeof raw==='string'?raw:Buffer.from(raw).toString('utf8')) as CallEvent;
  if(typeof event.event_id!=='string' || !event.event_id || event.event_id.length>200 || typeof event.provider_call_id!=='string' || !event.provider_call_id || !['ringing','answered','completed','busy','no_answer','failed','canceled'].includes(event.type) || !Number.isFinite(Date.parse(event.occurred_at)) || event.utterance && (event.utterance.speaker!=='Customer' || typeof event.utterance.text!=='string' || event.utterance.text.length>1700) || event.duration_seconds!==undefined&&(!Number.isInteger(event.duration_seconds)||event.duration_seconds<0) || event.cost&&(!Number.isFinite(event.cost.amount)||event.cost.amount<0||! /^[A-Z]{3}$/.test(event.cost.currency)||event.cost.fx_rate!==undefined&&(!Number.isFinite(event.cost.fx_rate)||event.cost.fx_rate<=0)))throw Error('INVALID_EVENT');
  return event;
 }
};
