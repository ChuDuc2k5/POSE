import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import { GatewayGateway } from '../src/gateway/gateway.gateway.js';
import { defaultScript } from '../src/modules/campaigns/script.js';

describe('calling and voice authenticated sockets',()=>{
 let app:INestApplication,interrupted=false,assigned=true;
 const sockets:WebSocket[]=[],id='f7800000-0000-4000-8000-000000000001';
 beforeEach(async()=>{
  interrupted=false;assigned=true;
  for(const [key,value] of Object.entries({SUPABASE_URL:'https://provider.example',SUPABASE_PUBLISHABLE_KEY:'public',SUPABASE_SECRET_KEY:'secret',AI_API_URL:'http://localhost:1234/v1',AI_MODEL:'fake'}))vi.stubEnv(key,value);
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
   const token=new Headers(init?.headers).get('Authorization')?.replace('Bearer ','')||'',role=token==='admin'?'Admin':token==='assigned'||token==='unassigned'?'Sales':token==='user'?'User':null;
   if(url.endsWith('/user'))return role?Response.json({id,email_confirmed_at:'2026-10-01'}):Response.json({msg:'Unauthorized'},{status:401});
   if(url.endsWith('/pose_access_context'))return Response.json({user_id:id,role,active:!!role,session_valid:!!role});
   if(url.includes('/calls?'))return Response.json(role==='Admin'||token==='assigned'&&assigned?{id}:null);
   if(url.includes('/call_script_versions?'))return Response.json({content:defaultScript});
   if(url.endsWith('/pose_voice_start'))return Response.json({id,provider:'simulator',call_type:'MOCK_CALL'});
   if(url.endsWith('/pose_system_voice_update')){const data=JSON.parse(typeof init?.body==='string'?init.body:'{}');if(data.p_event==='barge_in'){interrupted=true;return Response.json({interrupted:true});}if(data.p_event==='end')return Response.json({id,status:'COMPLETED'});const r=data.p_result;r.interrupted ||= interrupted;interrupted=false;return Response.json(r);}
   if(url.endsWith('/pose_system_call_context'))return Response.json({id,status:'ANSWERED',recording_status:'NotConsented',transcript_status:'Processing'});
   if(url.endsWith('/chat/completions'))return Response.json({choices:[{message:{content:JSON.stringify({reply:'Bạn muốn tư vấn khu vực nào?',intent:'real_estate',needs:[]})}}]});
   return Response.json([]);
  }));
  const module=await Test.createTestingModule({imports:[AppModule]}).compile();app=module.createNestApplication({bodyParser:false});configureApp(app);await app.listen(0,'127.0.0.1');
 });
 afterEach(async()=>{for(const socket of sockets.splice(0))socket.close();await app.close();vi.unstubAllEnvs();vi.unstubAllGlobals();});
 async function connect(token:string,namespace=''){
  const port=(app.getHttpServer().address() as AddressInfo).port,ws=new WebSocket(`ws://127.0.0.1:${port}/socket.io?EIO=4&transport=websocket`);sockets.push(ws);
  const prefix=namespace?`/${namespace},`:'',events:unknown[][]=[],pending=new Map<number,(data:Record<string,any>)=>void>();let seq=0;
  await new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Socket timeout')),3000);
   ws.onerror=()=>{clearTimeout(timer);reject(Error('Socket error'));};
   ws.onmessage=({data})=>{const frame=String(data);if(frame.startsWith('0'))ws.send('40'+prefix+JSON.stringify({token}));else if(frame.startsWith('40'+prefix)){clearTimeout(timer);resolve();}else if(frame.startsWith('44')){clearTimeout(timer);reject(Error('UNAUTHORIZED'));}else if(frame==='2')ws.send('3');else if(frame.startsWith('42'+prefix))events.push(JSON.parse(frame.slice(2+prefix.length)));else if(frame.startsWith('43'+prefix)){const tail=frame.slice(2+prefix.length),index=tail.indexOf('['),n=Number(tail.slice(0,index));pending.get(n)?.(JSON.parse(tail.slice(index))[0]);pending.delete(n);}};
  });
  return {events,send:(event:string,input:object={})=>new Promise<Record<string,any>>((resolve,reject)=>{const n=++seq,timer=setTimeout(()=>{pending.delete(n);reject(Error('Ack timeout'));},5000);pending.set(n,r=>{clearTimeout(timer);resolve(r);});ws.send('42'+prefix+n+JSON.stringify([event,input]));})};
 }
 it('emits call.status only to Admin and currently assigned Sales; excludes User and Guest',async()=>{
  const admin=await connect('admin'),sales=await connect('assigned'),other=await connect('unassigned'),user=await connect('user');
  await expect(connect('guest')).rejects.toThrow('UNAUTHORIZED');
  const call={id,status:'COMPLETED',end_reason:'SILENCE',ended_at:'2026-10-14T00:00:00Z',recording_status:'NotConsented',transcript_status:'Available',campaign_id:id};
  await app.get(GatewayGateway).callStatus(call);
  await vi.waitFor(()=>{expect(admin.events.some(e=>e[0]==='call.status')).toBe(true);expect(sales.events.some(e=>e[0]==='call.status')).toBe(true);});
  expect(admin.events.find(e=>e[0]==='call.status')?.[1]).toMatchObject({id,status:'COMPLETED',end_reason:'SILENCE',transcript_status:'Available'});
  expect(admin.events.some(e=>e[0]==='campaign.progress')).toBe(true);expect(other.events).toEqual([]);expect(user.events).toEqual([]);
  const previous=sales.events.length;assigned=false;await app.get(GatewayGateway).callStatus({...call,status:'CANCELED'});await new Promise(r=>setTimeout(r,50));expect(sales.events).toHaveLength(previous);
 });
 it('runs voice greeting, independent consents, fake LLM reply, interruption and three silences',async()=>{
  for(const token of ['assigned','user','guest'])await expect(connect(token,'voice')).rejects.toThrow('UNAUTHORIZED');
  const voice=await connect('admin','voice');expect(await voice.send('start',{script_version_id:'invalid'})).toHaveProperty('error');
  expect(await voice.send('start',{script_version_id:id})).toMatchObject({call_id:id});
  await vi.waitFor(()=>expect(voice.events.filter(e=>e[0]==='reply')).toHaveLength(1));
  expect((voice.events[0][1] as {text:string}).text).toContain('AI');
  for(let n=0;n<3;n++)expect(await voice.send('utterance',{text:'đồng ý'})).not.toHaveProperty('error');
  const reply=await voice.send('utterance',{text:'Tôi muốn mua căn hộ'});expect(reply.text).toBe('Bạn muốn tư vấn khu vực nào?');expect(reply.latency_ms).toBeGreaterThanOrEqual(0);
  expect(await voice.send('barge_in')).toEqual({interrupted:true});
  expect((await voice.send('utterance',{text:'Tôi cần tư vấn khu vực'})).interrupted).toBe(true);
  for(let n=0;n<3;n++){const result=await voice.send('silence');expect(result.state.silences).toBe(n+1);if(n===2)expect(result.state.end_reason).toBe('SILENCE');}
  expect(await voice.send('utterance',{text:'Sau kết thúc'})).toHaveProperty('error');
 });
 it('serializes simultaneous starts from one authenticated browser',async()=>{
  const voice=await connect('admin','voice');
  const results=await Promise.all([voice.send('start',{script_version_id:id}),voice.send('start',{script_version_id:id})]);
  expect(results.filter(r=>r.call_id===id)).toHaveLength(1);
  expect(results.filter(r=>typeof r.error==='string')).toHaveLength(1);
  expect(vi.mocked(fetch).mock.calls.filter(([url])=>typeof url==='string'&&url.endsWith('/pose_voice_start'))).toHaveLength(1);
 });
});
